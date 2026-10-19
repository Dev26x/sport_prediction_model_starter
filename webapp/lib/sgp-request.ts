class SgpRequestError extends Error {}
/** Research refreshes are cached/idempotent; a transient failure can retry the
 * same request. A changed sport pool aborts the old queue and its retries. */
export async function sgpRequest<T>(url:string,{body,signal}:{body?:unknown;signal?:AbortSignal}={}):Promise<T>{
 for(let attempt=0;attempt<15;attempt++){
  signal?.throwIfAborted();
  try{
   const response=await fetch(url,{cache:'no-store',signal,...body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}});
   if([409,500,502,503,504].includes(response.status)&&attempt<14){await new Promise(r=>setTimeout(r,1000));continue;}
   const value=await response.json() as T&{error?:string};if(!response.ok)throw new SgpRequestError(value.error||'Player research could not finish. Retry the analysis.');return value;
  }catch(error){if(signal?.aborted||error instanceof SgpRequestError||attempt===14)throw error;await new Promise(r=>setTimeout(r,1000));}
 }
 throw new Error('Player research is unavailable. Retry shortly.');
}
