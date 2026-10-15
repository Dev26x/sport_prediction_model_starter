declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    THERUNDOWN_API_KEY?: string;
  }
}
