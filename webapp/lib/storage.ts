import { env } from 'cloudflare:workers';
export function database() { if(!env.DB)throw new Error('Database binding is unavailable.');return env.DB; }
export async function cached<T>(key:string):Promise<{value:T;at:string}|null> {
  const r=await database().prepare('SELECT value, updated_at FROM cache_entries WHERE key = ?').bind(key).first<{value:string;updated_at:string}>();
  return r?{value:JSON.parse(r.value),at:r.updated_at}:null;
}
export async function putCache(key:string,value:unknown) {
  const at=new Date().toISOString();
  await database().prepare('INSERT INTO cache_entries (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),at).run();return at;
}
export function fresh(at:string|undefined|null,minutes:number) {return !!at&&Date.now()-Date.parse(at)<minutes*60000;}
export async function acquireLease() {
  const now=Date.now(),token=crypto.randomUUID();
  const r=await database().prepare('INSERT INTO refresh_leases (key,expires,token) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,token=excluded.token WHERE refresh_leases.expires < ? RETURNING token').bind('refresh',now+90000,token,now).first<{token:string}>();return r?.token===token?token:null;
}
export async function releaseLease(token:string) {await database().prepare('DELETE FROM refresh_leases WHERE key = ? AND token = ?').bind('refresh',token).run();}
