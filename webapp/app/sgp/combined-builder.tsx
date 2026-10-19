'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowLeft,ArrowUpRight,CalendarDays,Check,ChevronLeft,ChevronRight,Copy,Info,Layers3,LoaderCircle,RefreshCw,Sparkles } from 'lucide-react';
import type { DailySgpResponse,SgpPool } from '@/lib/sgp-types';
import { SGP_POOLS,sgpPoolSports } from '@/lib/sgp-pool';
import { sgpRequest } from '@/lib/sgp-request';
import { addDays } from '@/lib/models';
import SgpModeSwitch from './sgp-mode-switch';
const pct=(p:number|null)=>p===null?'—':`${(p*100).toFixed(p<.01?3:1)}%`;
const cad=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n);
export default function CombinedBuilder({initialDate,initialPool='both',combined=false}:{initialDate:string;initialPool?:SgpPool;combined?:boolean}){
 const [date,setDate]=useState(initialDate),[pool,setPool]=useState<SgpPool>(initialPool),[data,setData]=useState<DailySgpResponse|null>(null),[target,setTarget]=useState<'40'|'jackpot'>('40'),[working,setWorking]=useState(true),[error,setError]=useState(''),[progress,setProgress]=useState('Preparing the daily player pool'),[messages,setMessages]=useState<string[]>([]),[stake,setStake]=useState('5'),[notice,setNotice]=useState(''),[now,setNow]=useState(Date.now());
 const seq=useRef(0),active=useRef<AbortController|null>(null),poolLabel=SGP_POOLS.find(p=>p.id===pool)!.label;
 async function read(token:number,signal:AbortSignal){
  const board=await sgpRequest<DailySgpResponse>(`/api/sgp/daily?${new URLSearchParams({date,pool})}`,{signal});
  if(board.date!==date||board.pool!==pool)throw new Error('The research response belongs to another date or sport pool. Retry the analysis.');
  if(token===seq.current)setData(board);return board;
 }
 async function run(refresh=false){
  active.current?.abort();const controller=new AbortController();active.current=controller;
  const token=++seq.current,signal=controller.signal,logs:string[]=[];setWorking(true);setError('');setNotice('');setMessages([]);setProgress('Reading every upcoming game in this pool');
  try{
   if(refresh)for(const sport of sgpPoolSports(pool)){
    setProgress(`Checking ${sport.toUpperCase()} schedules and public results`);
    const result=await sgpRequest<{messages?:string[]}>('/api/refresh',{signal,body:{date,sport,book:'23',phase:`sources-${sport}`}});
    logs.push(...result.messages||[]);if(token!==seq.current)return;
   }
   const board=await read(token,signal),queue=refresh?board.fixtures:board.missing;
   for(let i=0;i<queue.length;i++){
    if(token!==seq.current)return;const f=queue[i];setProgress(`${refresh?'Updating':'Analyzing'} ${i+1}/${queue.length} · ${f.sport.toUpperCase()} · ${f.away.abbr} at ${f.home.abbr}`);
    try{
     const result=refresh?await sgpRequest<{messages?:string[]}>('/api/sgp/daily',{signal,body:{date,sport:f.sport,fixture:f.id}}):await sgpRequest<{messages?:string[]}>(`/api/sgp/daily?${new URLSearchParams({date,sport:f.sport,fixture:f.id})}`,{signal});
     logs.push(...result.messages||[]);
    }catch(e){if(signal.aborted)throw e;logs.push(`${f.away.abbr} at ${f.home.abbr}: ${(e as Error).message}`);}
    if(token===seq.current)setMessages([...logs]);
   }
   if(token!==seq.current)return;
   // Shared player updates can invalidate groups analyzed earlier in the queue.
   // Complete every remaining group before calling a combination slate-wide.
   const latest=await read(token,signal);
   for(const f of latest.missing){
    if(token!==seq.current)return;setProgress(`Rechecking updated inputs · ${f.away.abbr} at ${f.home.abbr}`);
    try{await sgpRequest(`/api/sgp/daily?${new URLSearchParams({date,sport:f.sport,fixture:f.id})}`,{signal});}
    catch(e){if(signal.aborted)throw e;logs.push(`${f.away.abbr} at ${f.home.abbr}: ${(e as Error).message}`);}
   }
   if(token!==seq.current)return;const final=await read(token,signal);setMessages([...new Set(logs)]);setNow(Date.now());
   if(final.missing.length)throw new Error(`${final.missing.length} game${final.missing.length===1?' still needs':'s still need'} analysis. Retry to complete this sport pool before building the best combined slip.`);
   setProgress('Combined player-prop research ready');
  }catch(e){if(token===seq.current&&!signal.aborted)setError((e as Error).message);}
  finally{if(token===seq.current)setWorking(false);}
 }
 useEffect(()=>{void run();return()=>{seq.current++;active.current?.abort();};},[date,pool]);
 useEffect(()=>{window.history.replaceState(null,'',`${combined?'/sgp':'/sgp/daily'}?${new URLSearchParams({date,pool,...combined?{mode:'combined'}:{}})}`);},[date,pool,combined]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 const current=data?.date===date&&data.pool===pool?data:null,expired=!!current?.fixtures.some(f=>Date.parse(f.start)<=now+300000),complete=!!current&&!current.missing.length&&!working&&!error&&!expired,s=complete?current.suggestions.find(s=>s.id===target):undefined,legs=s?.groups.flatMap(g=>g.legs)||[],number=Number(stake),validStake=Number.isFinite(number)&&number>0&&number<=100000,returns=s?.fairOdds&&validStake?s.fairOdds*number:null;
 async function copy(){
  if(!s?.groups.length||!complete)return;
  const text=['MATCHDAY · COMBINED PLAYER-PROP SGP+ RESEARCH',`${date} · ${poolLabel}`,target==='40'?'40–60 model fair odds':'Jackpot 1000+ model fair odds',...s.groups.flatMap(g=>[`${g.fixture.sport.toUpperCase()} · ${g.fixture.away.name} at ${g.fixture.home.name}`,`Within-game joint chance ${pct(g.joint.probability)} · model fair ${g.joint.fairOdds?.toFixed(2)}`,...g.legs.map(l=>`${l.label} | conditional ${pct(l.probability)} | ${l.reason}`)]),`Combined chance ${pct(s.probability)} (independence between games)`,`Model fair decimal odds ${s.fairOdds?.toFixed(2)||'unresolved'}; NOT a sportsbook SGP+ quote`,s.reason,`Hypothetical CAD stake ${validStake?cad(number):'not entered'}; illustrative return ${returns?cad(returns):'unavailable'}; illustrative profit ${returns?cad(returns-number):'unavailable'}`,'Experimental, uncalibrated model estimates. Excluded from the CAD paper wallet. No bet placed.'].join('\n');
  try{await navigator.clipboard.writeText(text);setNotice('Combined SGP+ research copied.');}
  catch{const url=URL.createObjectURL(new Blob([text],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download=`matchday-combined-sgp-${pool}-${date}.txt`;a.click();URL.revokeObjectURL(url);setNotice('Combined SGP+ research downloaded.');}
 }
 return <div className="reports-shell sgp-shell daily-sgp-shell"><header className="reports-top"><a className="reports-brand" href="/">matchday<span>.</span></a><nav><a href={`/?date=${date}`}><ArrowLeft size={14}/> Slip workspace</a><a href="/wnba-finals">WNBA Finals <ArrowUpRight size={13}/></a><a href="/paper">Paper wallet <ArrowUpRight size={13}/></a></nav></header><main className="reports-main">
  <section className="reports-hero"><div><div className="eyebrow"><span/> THE DAILY PLAYER POOL</div><h1>The best props.<br/>Across the games<span>.</span></h1><p>Choose NBA, NFL or both. Build one combined player-prop research slip.</p></div><div className="reports-private"><Layers3 size={27}/><span>Correlations inside each game<br/><b>Independence between games</b></span></div></section>
  <SgpModeSwitch date={date} mode="combined" sport={pool==='nfl'?'nfl':'nba'}/>
  <section className="reports-controls combined-sgp-controls"><div className="report-date"><CalendarDays size={17}/><button aria-label="Previous combined SGP date" disabled={working||date<='2025-10-01'} onClick={()=>setDate(addDays(date,-1))}><ChevronLeft size={16}/></button><label><span className="sr-only">Combined SGP date</span><input aria-label="Combined SGP date" type="date" min="2025-10-01" max="2027-06-30" value={date} disabled={working} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button aria-label="Next combined SGP date" disabled={working||date>='2027-06-30'} onClick={()=>setDate(addDays(date,1))}><ChevronRight size={16}/></button></div>
   <div className="combined-sgp-pools" role="group" aria-label="Combined SGP sports">{SGP_POOLS.map(p=><button key={p.id} className={pool===p.id?'selected':''} aria-pressed={pool===p.id} onClick={()=>setPool(p.id)}>{p.label}</button>)}</div>
   <button className="primary-button" disabled={working} onClick={()=>void run(true)}>{working?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>} Update {pool==='both'?'all':pool.toUpperCase()} player data</button></section>
  <div className="reports-status" role="status"><span className={`status-dot ${working?'pulsing':''}`}/>{working?progress:`${current?.ready||0} / ${current?.fixtures.length||0} eligible games analyzed · ${poolLabel} · Toronto dates`}<span>Player props only · no paid odds calls</span></div>
  {error&&<div className="error-banner" role="alert">{error}<button disabled={working} onClick={()=>void run()}>Retry analysis</button></div>}{notice&&<div className="sgp-notice" role="status"><Check size={14}/>{notice}</div>}
  {expired&&!working&&<div className="error-banner" role="alert">The slate changed: a game is within five minutes of starting. Rebuild with the remaining games.<button onClick={()=>void run()}>Rebuild current slate</button></div>}
  <div className="sgp-price-note"><Info size={18}/><div><strong>Combined player props · model fair prices</strong><p>All eligible games in your sport pool enter the search. The model selects a compatible combination toward the target; selected games can vary. Same-game correlations are retained, and separate-game joint chances multiply under an independence assumption. Prices are <b>1 ÷ modeled joint chance</b>, with no connected sportsbook SGP+ quote. Estimates are experimental and uncalibrated.</p></div></div>
  <section className="combined-sgp-coverage" aria-label="Sport pool coverage">{sgpPoolSports(pool).map(sport=>{const fixtures=current?.fixtures.filter(f=>f.sport===sport)||[],pending=current?.missing.filter(f=>f.sport===sport).length||0;return <div key={sport}><b>{sport.toUpperCase()}</b><strong>{fixtures.length}<span> eligible games</span></strong><small>{working?'Checking this pool':fixtures.length?`${fixtures.length-pending} analyzed · ${pending} awaiting analysis`:'No upcoming supported regular-season games on this date'}</small></div>;})}<p>Games must be scheduled and more than five minutes from starting. Preseason, completed and unsupported fixtures are excluded. Every eligible game is considered; no game-count cap.</p></section>
  <div className="daily-sgp-target-bar"><div className="sgp-targets" role="group" aria-label="Combined SGP target"><button className={target==='40'?'selected':''} aria-pressed={target==='40'} onClick={()=>setTarget('40')}>40–60 odds</button><button className={target==='jackpot'?'selected':''} aria-pressed={target==='jackpot'} onClick={()=>setTarget('jackpot')}>Jackpot <small>1000+</small></button></div><p><Sparkles size={14}/> Fixed, supported player milestones feed both targets.</p></div>
  {s?.groups.length?<><section className="daily-sgp-summary"><div><span>MODEL FAIR COMBINED ODDS</span><strong>{s.fairOdds?.toFixed(2)||'Unresolved'}</strong><small>{s.targetReached?'Model target reached':'Target not reached'}</small></div><div><span>ESTIMATED JOINT CHANCE</span><strong>{pct(s.probability)}</strong><small>Conditional on projected participation</small></div><div><span>THE COMBINATION</span><strong>{legs.length}<i> props</i></strong><small>{s.groups.length} selected games · {poolLabel}</small></div></section><p className="daily-sgp-reason">{s.reason} The best combination found uses an approximate search over supported per-game prefixes, with 0.002 log-probability bins. It is not a proven global optimum. There is no game-count cap.</p>
   <section className="daily-sgp-games">{s.groups.map(g=><article className="daily-sgp-game" key={`${g.fixture.sport}:${g.fixture.id}`}><header><div><span className="eyebrow">{g.fixture.sport.toUpperCase()} · {g.legs.length} PLAYER {g.legs.length===1?'PROP':'PROPS'}</span><h2>{g.fixture.away.name}<span>at</span>{g.fixture.home.name}</h2><p>{new Date(g.fixture.start).toLocaleString('en-CA',{timeZone:'America/Toronto'})} ET</p></div><div><strong>{pct(g.joint.probability)}</strong><span>within-game joint chance</span><b>Fair {g.joint.fairOdds?.toFixed(2)}</b></div></header><div className="daily-sgp-props">{g.legs.map(l=><details key={l.id}><summary><span>{l.label}</span><b>{pct(l.probability)}</b></summary><p>{l.reason}</p><p>Current season: {l.currentMean===null?'No regular-season boxes yet':`${l.currentMean.toFixed(1)} average in ${l.currentGames} games`}. Earlier history: {l.historyGames} games. Last five: {l.lastFive.join(', ')}.</p>{l.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>)}</div><footer><span>Measured correlations: {g.joint.measuredPairs} / {g.joint.totalPairs} pairs. Sparse pairs use zero correlation.</span><a href={`/sgp?date=${date}&sport=${g.fixture.sport}&fixture=${g.fixture.id}`}>Full player research <ArrowUpRight size={12}/></a></footer></article>)}</section>
   <section className="daily-sgp-bottom"><div className="sgp-calculator"><label htmlFor="combined-stake">Hypothetical stake <span>CAD · separate illustration</span></label><div className="sgp-stake"><span>C$</span><input id="combined-stake" aria-label="Combined SGP hypothetical stake CAD" type="number" value={stake} min="0.01" max="100000" step="0.01" onChange={e=>setStake(e.target.value)}/></div>{stake&&!validStake&&<small>Enter a stake above CAD 0 and at most CAD 100,000.</small>}<div><span>Fair-price illustrative return</span><b>{returns?cad(returns):'—'}</b></div><div><span>Fair-price illustrative profit</span><b>{returns?cad(returns-number):'—'}</b></div><p>The paper wallet is unchanged. No bet is placed or recorded.</p></div><button className="primary-button" disabled={!complete} onClick={()=>void copy()}><Copy size={14}/> Copy combined SGP+ research</button></section>
  </>:<section className="sgp-empty"><Layers3 size={35}/><h2>{working?'Evaluating the day’s player props':expired?'Rebuild for the remaining games':error?'Complete the game analysis to build a slip':`No supported combined SGP+ in this ${poolLabel} pool.`}</h2><p>{working?progress:error?'All eligible games must finish analysis before the builder presents the combined result.':'Choose a date with upcoming supported regular-season games, or change the sport pool.'}</p>{!working&&<button className="outline-button" onClick={()=>void run(true)}><RefreshCw size={13}/> Check public schedule and player data</button>}</section>}
  <details className="report-feed-status"><summary>Data checks and combination method</summary><p>Every game’s player milestones are fixed before either odds target. Same-game calculations use the existing 65,536-draw, shrunk Gaussian-copula model. Incompatible or logically nested props cannot be combined. The daily search chooses one compatible prefix per included game and preserves the greatest combined probability found within the target. Single supported props may accompany same-game groups. No harder line is introduced to force a target.</p><p>Use Update player data to check public schedules, current rosters, injury flags, player boxes and team news for the selected sport pool. Initial analysis reuses available snapshots. Public-source caches and eligibility rules match the single-game builder. Estimates assume the projected role and participation; they are not calibrated win rates. Available sportsbook lines, prices, settlement and combination limits can differ. Combined suggestions never debit the CAD paper wallet.</p>{current&&<p>Slate analyzed {new Date(current.generatedAt).toLocaleString('en-CA',{timeZone:'America/Toronto'})} ET. This is the analysis time, not a guarantee that all underlying player data was updated at that time.</p>}{messages.map((m,i)=><p key={i}>{m}</p>)}</details>
 </main></div>;
}
