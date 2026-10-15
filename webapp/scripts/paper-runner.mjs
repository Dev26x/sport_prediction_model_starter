// Standard-library runner for the owner's linked daily cloud task.
// Input: one JSON line on stdin with {serviceToken, command:"run"|"read"|"hash"|"confirm"}.
// Never pass a credential through command arguments, environment files or logs.
import { createHash } from 'node:crypto';
const SITE='https://matchday-model-lab.sharpdaisy256.chatgpt.site';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');process.stdout.write('Ready for paper runner JSON on stdin (input is hidden).\n');
let input='';const body=await new Promise((resolve,reject)=>{process.stdin.on('data',chunk=>{input+=chunk;if(input.includes('\n')||input.includes('\r')){try{resolve(JSON.parse(input.trim()));}catch(e){reject(e);}process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);}});});
if(!body.serviceToken||typeof body.serviceToken!=='string')throw new Error('A Site service credential from get_site is required.');
const hash=s=>createHash('sha256').update(s).digest('hex'),key=hash('matchday-paper-runner:v1\0'+body.serviceToken),headers={'OAI-Sites-Authorization':`Bearer ${body.serviceToken}`,'X-Paper-Runner-Key':key,'Content-Type':'application/json'};
if(body.command==='hash'){process.stdout.write(JSON.stringify({runnerHash:hash(key)})+'\n');process.exit(0);}
async function call(value){
 for(let i=0;i<16;i++){
  let r;
  try{r=await fetch(SITE+'/api/paper',{method:value?'POST':'GET',headers,redirect:'manual',...(value?{body:JSON.stringify(value)}:{}),signal:AbortSignal.timeout(60000)});}
  catch{if(i===15)throw new Error('Paper updater network request failed; saved records preserved, no credentials logged.');await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  if([409,500,502,503,504].includes(r.status)&&i<15){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  if(!r.ok)throw new Error(`Paper updater returned HTTP ${r.status}; no credentials logged.`);
  return r.json();
 }
}

if(body.command==='confirm'){const r=await call({action:'schedule-confirm'});process.stdout.write(JSON.stringify(r)+'\n');process.exit(0);}
let state=await call();
if(body.command!=='read'){
 for(const group of state.resultGroups){const[day,sport]=group.split(':');const r=await call({action:'settle',day,sport});process.stdout.write(JSON.stringify({step:'settle',day,sport,messages:r.messages})+'\n');}
 if(!state.days.some(d=>d.day===state.today)){
  for(const sport of ['nba','nfl','nhl','epl','laliga','seriea']){const r=await call({action:'source',sport});process.stdout.write(JSON.stringify({step:'source',sport,messages:r.messages})+'\n');}
  for(const action of ['rosters','depth','players','nba-context']){const r=await call({action});process.stdout.write(JSON.stringify({step:action,messages:r.messages})+'\n');}
  const r=await call({action:'capture'});process.stdout.write(JSON.stringify({step:'capture',messages:r.messages})+'\n');
 }
 state=await call();
}
process.stdout.write(JSON.stringify({today:state.today,captured:state.days.some(d=>d.day===state.today),summary:state.summary,resultGroups:state.resultGroups,automation:state.automation})+'\n');
process.exit(0);
