"""Bounded HTTP reads with cached responses and no credentials in URLs/logs."""

from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class DataAccessError(RuntimeError):
    pass


class SameHostRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).netloc != urlsplit(req.full_url).netloc:
            raise DataAccessError("Refused a cross-host redirect with request headers.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class JsonClient:
    def __init__(self, cache_dir, headers=None, timeout=20, retries=1, refresh=False):
        self.cache_dir = Path(cache_dir)
        self.headers = {"User-Agent": "NBAResearchStarter/1.0", "Accept": "application/json", "Accept-Encoding": "gzip"}
        self.headers.update(headers or {})
        self.timeout, self.retries, self.refresh = timeout, retries, refresh
        self.opener = build_opener(SameHostRedirect())

    def _read(self, url):
        # macOS's system curl uses the OS certificate store. Some standalone
        # Python installs have no CA bundle; never disable TLS verification.
        if shutil.which("curl"):
            def quote(value):
                return str(value).replace("\\", "\\\\").replace('"', '\\"')
            config = "\n".join(f'header = "{quote(key)}: {quote(value)}"' for key, value in self.headers.items())
            with tempfile.TemporaryDirectory(prefix="nba-http-") as directory:
                headers_path = Path(directory) / "response_headers.txt"
                command = ["curl", "--silent", "--show-error", "--compressed", "--max-time", str(self.timeout),
                           "--config", "-", "--dump-header", str(headers_path),
                           "--write-out", "\n__NBA_HTTP_%{http_code}", "--url", url]
                response = subprocess.run(command, input=config.encode(), capture_output=True, timeout=self.timeout + 5)
                if response.returncode:
                    raise URLError(f"curl transport failed (code {response.returncode})")
                raw, marker, code = response.stdout.rpartition(b"\n__NBA_HTTP_")
                if not marker:
                    raise DataAccessError("Transport returned no HTTP status.")
                if int(code) != 200:
                    raise HTTPError(url, int(code), "Request failed", {}, None)
                headers = {}
                for line in headers_path.read_text().splitlines():
                    if ":" in line:
                        key, value = line.split(":", 1)
                        headers[key.strip()] = value.strip()
                return raw, headers
        with self.opener.open(Request(url, headers=self.headers), timeout=self.timeout) as response:
            return response.read(), dict(response.headers.items())

    def get(self, url, params=None):
        if params:
            url += ("&" if "?" in url else "?") + urlencode(params)
        if urlsplit(url).scheme != "https":
            raise DataAccessError("Data requests require HTTPS.")
        cache_key = hashlib.sha256(url.encode()).hexdigest()
        path = self.cache_dir / f"{cache_key}.json.gz"
        if path.exists() and not self.refresh:
            return json.loads(gzip.decompress(path.read_bytes()))
        for attempt in range(self.retries + 1):
            try:
                raw, response_headers = self._read(url)
                if raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                payload = {
                    "data": json.loads(raw),
                    "source_url": url,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "response_headers": {k: v for k, v in response_headers.items()
                                         if k.lower().startswith(("x-stats-", "x-datapoints", "retry-after"))},
                }
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".tmp")
                temporary.write_bytes(gzip.compress(json.dumps(payload).encode()))
                temporary.replace(path)
                return payload
            except HTTPError as error:
                if error.code in (401, 403):
                    raise DataAccessError(f"HTTP {error.code}: authentication or data entitlement denied at {urlsplit(url).netloc}.") from None
                if error.code not in (429, 500, 502, 503, 504) or attempt == self.retries:
                    raise DataAccessError(f"HTTP {error.code} from {urlsplit(url).netloc}{urlsplit(url).path}.") from None
            except (URLError, TimeoutError, OSError) as error:
                if attempt == self.retries:
                    reason = getattr(error, "reason", error)
                    raise DataAccessError(f"Could not read {urlsplit(url).netloc}: {type(reason).__name__}: {reason}.") from None
            time.sleep(min(attempt + 1, 2))
        raise DataAccessError("Request did not complete.")
