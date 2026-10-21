'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowLeft,ArrowUpRight,CalendarDays,Check,ChevronLeft,ChevronRight,Info,Layers3,LoaderCircle,RefreshCw,Ticket } from 'lucide-react';
import type { DailySgpResponse,DailySgpProfile,SgpPool } from '@/lib/sgp-types';
import { SGP_POOLS,sgpPoolSports } from '@/lib/sgp-pool';
import { sgpRequest } from '@/lib/sgp-request';
import { addDays } from '@/lib/models';
import SimpleCombinedSlip from './simple-combined-slip';

const pct=(p:number|null)=>p===null?'—':`${(p*100).toFixed(p<.01?3:1)}%`;
export default function CombinedBuilder({initialDate,initialPool='nba',combined=false,analysisView=false}:{initialDate:string;initialPool?:SgpPool;combined?:boolean;analysisView?:boolean}){
 const [date,setDate]=useState(initialDate),[pool,setPool]=useState<SgpPool>(initialPool),[data,setData]=useState<DailySgpResponse|null>(null),[target,setTarget]=useState<DailySgpProfile>('20'),[stake,setStake]=useState('2'),[working,setWorking]=useState(true),[error,setError]=useState(''),[progress,setProgress]=useState('Preparing the daily player pool'),[messages,setMessages]=useState<string[]>([]),[notice,setNotice]=useState(''),[now,setNow]=useState(Date.now());
 const seq=useRef(0),active=useRef<AbortController|null>(null),poolLabel=SGP_POOLS.find(p=>p.id===pool)!.label;
 async function read(token:number,signal:AbortSignal){
  const board=await sgpRequest<DailySgpResponse>(`/api/sgp/daily?${new URLSearchParams({date,pool})}`,{signal});
  if(board.date!==date||board.pool!==pool)throw new Error('The research response belongs to another date or sport pool. Retry the analysis.');
  if(token===seq.current)setData(board);return board;
 }
 async function run(refresh=true){
  active.current?.abort();const controller=new AbortController();active.current=controller;
  const token=++seq.current,signal=controller.signal,logs:string[]=[];setWorking(true);setError('');setNotice('');setMessages([]);setProgress('Reading every upcoming game in this pool');
  try{
   if(refresh)for(const sport of sgpPoolSports(pool)){
    setProgress(`Checking ${sport.toUpperCase()} schedules and public results`);
    const result=await sgpRequest<{messages?:string[]}>('/api/sgp/daily',{signal,body:{date,sport}});
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
 useEffect(()=>{window.history.replaceState(null,'',`${analysisView?'/sgp/analysis':combined?'/sgp':'/sgp/daily'}?${new URLSearchParams({date,pool,...combined&&!analysisView?{mode:'combined'}:{}})}`);},[date,pool,combined,analysisView]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 const current=data?.date===date&&data.pool===pool?data:null,expired=!!current?.fixtures.some(f=>Date.parse(f.start)<=now+300000),complete=!!current&&!current.missing.length&&!working&&!error&&!expired;
 const suggestion=complete?current.suggestions.find(s=>s.id===target):null;
 const targetLabel=target==='jackpot'?'Jackpot 1000+':`${target} odds`;
 async function copy(){if(!suggestion?.targetReached||!suggestion.groups.length)return;const lines=['MATCHDAY · COMBINED PLAYER-PROP SLIP',`${date} · ${poolLabel} · ${targetLabel}`,...suggestion.groups.flatMap(g=>g.legs.map(p=>({p,fixture:g.fixture}))).map(({p,fixture},i)=>`${i+1}. ${p.label} | ${fixture.away.name} at ${fixture.home.name}`),`Estimated combined odds: ${suggestion.fairOdds?.toFixed(2)??'unavailable'} (model estimate, not a FanDuel quote)`,`Estimated slip probability: ${pct(suggestion.probability)}`,suggestion.targetReached?'Target reached on model estimates':'Target not reached with supported picks'];try{await navigator.clipboard.writeText(lines.join('\n'));setNotice('Slip copied.');}catch{setNotice('Copy is unavailable. You can select the picks on this page.');}}
 return <div className="reports-shell sgp-shell daily-sgp-shell"><header className="reports-top"><a className="reports-brand" href="/">matchday<span>.</span></a><nav><a href={`/?date=${date}`}><ArrowLeft size={14}/> Slip workspace</a><a href="/wnba-finals">WNBA Finals <ArrowUpRight size={13}/></a><a href="/paper">Paper wallet <ArrowUpRight size={13}/></a></nav></header><main className="reports-main">
  <section className="reports-hero"><div><div className="eyebrow"><span/> {analysisView?'THE RESEARCH':'ONE COMBINED SLIP'}</div><h1>{analysisView?<>The work behind<br/>the picks<span>.</span></>:<>The best picks.<br/>One slip<span>.</span></>}</h1><p>{analysisView?'Player history, recent performance and the supporting data.':'Player props from the available games, combined automatically.'}</p></div><div className="reports-private"><Ticket size={27}/><span>{poolLabel}<br/><b>Up to 10 props per game</b></span></div></section>
  <div className="sgp-mode-switch"><a className={!analysisView?'active':''} href={`/sgp/daily?${new URLSearchParams({date,pool})}`}><Ticket size={18}/><span><b>Combined slip</b><small>20 · 50 · 200 · Jackpot 1000+</small></span></a><a className={analysisView?'active':''} href={`/sgp/analysis?${new URLSearchParams({date,pool})}`}><Info size={18}/><span><b>Analysis</b><small>View the research separately</small></span></a></div>
  <section className="reports-controls combined-sgp-controls"><div className="report-date"><CalendarDays size={17}/><button aria-label="Previous combined SGP date" disabled={working||date<='2025-10-01'} onClick={()=>setDate(addDays(date,-1))}><ChevronLeft size={16}/></button><label><span className="sr-only">Combined SGP date</span><input aria-label="Combined SGP date" type="date" min="2025-10-01" max="2027-06-30" value={date} disabled={working} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button aria-label="Next combined SGP date" disabled={working||date>='2027-06-30'} onClick={()=>setDate(addDays(date,1))}><ChevronRight size={16}/></button></div>
   <div className="combined-sgp-pools" role="group" aria-label="Combined SGP sports">{SGP_POOLS.map(p=><button key={p.id} className={pool===p.id?'selected':''} aria-pressed={pool===p.id} onClick={()=>setPool(p.id)}>{p.label}</button>)}</div>
   <button className="primary-button" disabled={working} onClick={()=>void run(true)}>{working?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>} Refresh &amp; recalculate {pool==='both'?'all':pool.toUpperCase()} SGPs</button></section>
  <div className="reports-status" role="status"><span className={`status-dot ${working?'pulsing':''}`}/>{working?progress:`${current?.ready||0} / ${current?.fixtures.length||0} eligible games analyzed · ${poolLabel} · Toronto dates`}<span>Player props only · no paid odds calls</span></div>
  {error&&<div className="error-banner" role="alert">{error}<button disabled={working} onClick={()=>void run()}>Retry analysis</button></div>}{notice&&<div className="sgp-notice" role="status"><Check size={14}/>{notice}</div>}
  {expired&&!working&&<div className="error-banner" role="alert">The slate changed: a game is within five minutes of starting. Rebuild with the remaining games.<button onClick={()=>void run()}>Rebuild current slate</button></div>}
  {analysisView?<>
   <section className="combined-sgp-coverage" aria-label="Sport pool coverage">{sgpPoolSports(pool).map(sport=><div key={sport}><b>{sport.toUpperCase()}</b><strong>{current?.fixtures.filter(f=>f.sport===sport).length||0}<span> eligible games</span></strong></div>)}<p>Fixtures must be upcoming, supported and more than five minutes from tipoff. Each game contributes up to 10 compatible props. There is no 40% cutoff and no cap on the number of games.</p></section>
   {complete&&current.gameOptions?.map(set=><section className="daily-sgp-game" id={`analysis-${set.fixture.sport}-${set.fixture.id}`} key={`${set.fixture.sport}:${set.fixture.id}`}><header><div><span className="eyebrow">{set.fixture.sport.toUpperCase()} · PLAYER RESEARCH</span><h2>{set.fixture.away.name} at {set.fixture.home.name}</h2><p>{set.candidates.length} supported player props</p></div><a href={`/sgp?${new URLSearchParams({date,sport:set.fixture.sport,fixture:set.fixture.id})}`}>Individual game analysis ↗</a></header><div className="daily-sgp-props">{set.candidates.map(p=><details key={p.id}><summary><span>{p.label}</span><b>{pct(p.probability)}</b></summary><p>{p.reason}</p><p>Last five: {p.lastFive.join(', ')}. History: {p.historyGames} games. Current season: {p.currentGames} games.</p>{p.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>)}</div></section>)}
   <details className="report-feed-status"><summary>Method and data checks</summary><p>Player milestones are set from historical production before target selection. Compatible per-game groups use 65,536 simulations with measured and shrunk dependence; unknown pair relationships are treated as zero correlation. The game search evaluates different compatible subsets at every leg count from two to ten. To avoid padding, it keeps compact representatives within 0.025 log-probability buckets; a diverse beam bounds large searches. The combined search independently ranks each odds target from these different game subsets. Different games are multiplied under an independence assumption. Search is approximate on large slates. Model estimates are uncalibrated; no live FanDuel SGP quote feed is connected.</p><p>Fresh public roster, injury and player-data checks are used when available. Failed sources retain dated snapshots. A roster is not a confirmed active lineup.</p>{messages.map((m,i)=><p key={i}>{m}</p>)}</details>
  </>:<>
   <SimpleCombinedSlip date={date} pool={pool} target={target} suggestion={suggestion} stake={stake} onTarget={setTarget} onStake={setStake} onCopy={()=>void copy()} working={working} error={error} progress={progress}/>

  </>}
 </main></div>;
}
