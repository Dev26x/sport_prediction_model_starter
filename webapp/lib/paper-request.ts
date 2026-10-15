class PaperRequestError extends Error {}

/** Paper operations use immutable IDs or set totals, so a lost response can
 * safely be retried without charging another stake or crediting another win. */
export async function paperRequest<T>(body?:Record<string,string>):Promise<T>{
 for(let attempt=0;attempt<15;attempt++){
  try{
   const response=await fetch('/api/paper',{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
   if([409,500,502,503,504].includes(response.status)&&attempt<14){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
   const value=await response.json() as T&{error?:string};
   if(!response.ok)throw new PaperRequestError(value.error||'Paper update could not finish. Stored records are preserved; try Check results again.');
   return value;
  }catch(error){
   if(error instanceof PaperRequestError||attempt===14)throw error;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }
 throw new Error('Paper updater unavailable. Stored records are preserved.');
}
