import { normalCdf } from './models';
import type { Fixture } from './types';
import type { SgpCandidate,SgpDataset,SgpJoint,SgpSuggestion,PlayerLog,SgpRosterPlayer,SgpSport,SgpPrefixSet,DailySgpSuggestion } from './sgp-types';

export const SGP_MODEL_VERSION='player-copula-v1.1';
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const average=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
export function nameKey(s:string){return s.toLowerCase().replace(/[^a-z0-9]/g,'');}
export function currentSgpSeason(day:string,sport:SgpSport){return Number(day.slice(0,4))+(sport==='nba'&&Number(day.slice(5,7))>=7?1:0);}
export function priorLogs(data:SgpDataset,id:string,before:string,sport:SgpSport){const current=currentSgpSeason(before,sport);return (data.players[id]?.logs||[]).filter(r=>data.games[r[0]]&&data.games[r[0]][1]<before&&data.games[r[0]][2]>=current-4&&data.games[r[0]][2]<=current).sort((a,b)=>data.games[b[0]][1].localeCompare(data.games[a[0]][1]));}
function weights(data:SgpDataset,logs:PlayerLog[],before:string){return logs.map(r=>Math.exp(-Math.LN2*Math.max(0,(Date.parse(before)-Date.parse(data.games[r[0]][1]))/86400000)/365));}
function weighted(values:number[],w:number[]){const sum=w.reduce((a,b)=>a+b,0);return sum?values.reduce((s,v,i)=>s+v*w[i],0)/sum:0;}
function quantile(values:number[],w:number[],q:number){const rows=values.map((v,i)=>({v,w:w[i]})).sort((a,b)=>a.v-b.v),total=w.reduce((a,b)=>a+b,0);let c=0;for(const r of rows){c+=r.w;if(c>=q*total)return r.v;}return rows.at(-1)?.v||0;}
function opponentId(data:SgpDataset,r:PlayerLog){const g=data.games[r[0]];return g[3]===r[1]?g[4]:g[3];}
// Defence is measured at team level, avoiding confounding by the number of players.
// Shrink its ratio with 20 average games and cap the extrapolation at +/-15%.
export function opponentAdjustment(data:SgpDataset,opponent:string,metric:number,before:string,sport:SgpSport){
 const totals=new Map<string,{game:number;team:string;sum:number}>(),season=currentSgpSeason(before,sport);
 for(const p of Object.values(data.players))for(const r of p.logs){const g=data.games[r[0]];if(!g||g[1]>=before||g[2]<season-2)continue;const key=`${r[0]}:${r[1]}`,t=totals.get(key)||{game:r[0],team:r[1],sum:0};t.sum+=Number(r[metric+3]);totals.set(key,t);}
 const rows=[...totals.values()],w=rows.map(r=>Math.exp(-Math.LN2*(Date.parse(before)-Date.parse(data.games[r.game][1]))/86400000/180));
 const league=weighted(rows.map(r=>r.sum),w);let sum=0,weight=0,count=0;
 for(let i=0;i<rows.length;i++){const r=rows[i],g=data.games[r.game];if((g[3]===r.team?g[4]:g[3])===opponent){sum+=r.sum*w[i];weight+=w[i];count++;}}
 return {factor:league>0?clamp((sum+20*league)/(weight+20)/league,.85,1.15):1,games:count};
}
export function playerCandidates(data:SgpDataset,fixture:Fixture,before:string,rosters:Record<string,SgpRosterPlayer[]>,now=Date.now()){
 const sport=fixture.sport as SgpSport,candidates:SgpCandidate[]=[],excluded:{player:string;reason:string}[]=[],opponents=new Map<string,number>();
 for(const team of [fixture.away.id,fixture.home.id]){
  const opponent=team===fixture.home.id?fixture.away.id:fixture.home.id;
  for(let metric=0;metric<data.metrics.length;metric++)opponents.set(`${opponent}:${metric}`,opponentAdjustment(data,opponent,metric,before,sport).factor);
  for(const member of rosters[team]||[]){
   const logs=priorLogs(data,member.id,before,sport),minimum=sport==='nba'?25:12,history=data.players[member.id];
   const status=member.injury.trim();
   if(status){excluded.push({player:member.name,reason:`${status} roster flag. Excluded until a new public roster check clears the flag; no healthy assumption.`});continue;}
   if(!history||logs.length<minimum){excluded.push({player:member.name,reason:`Only ${logs.length} earlier regular-season boxes; ${minimum} required. Rookies and small samples receive no invented projection.`});continue;}
   const w=weights(data,logs,before),sumW=w.reduce((a,b)=>a+b,0),effective=sumW**2/w.reduce((s,x)=>s+x*x,0),latest=data.games[logs[0][0]][1];
   if(Date.parse(before)-Date.parse(latest)>(sport==='nba'?450:400)*86400000){excluded.push({player:member.name,reason:'No sufficiently recent regular-season playing history.'});continue;}
   if(sport==='nba'&&average(logs.slice(0,10).map(r=>r[2]))<18){excluded.push({player:member.name,reason:'Recent playing time is below 18 minutes; rotation role is too uncertain.'});continue;}
   const current=logs.filter(r=>data.games[r[0]][2]===currentSgpSeason(before,sport));
   if(sport==='nfl'){
    const teamGames=new Set(Object.values(data.players).flatMap(p=>p.logs.filter(r=>r[1]===team&&data.games[r[0]][1]<before&&data.games[r[0]][2]===currentSgpSeason(before,sport)).map(r=>r[0])));
    const latestTeam=[...teamGames].sort((a,b)=>data.games[b][1].localeCompare(data.games[a][1]))[0];
    if(latestTeam===undefined||!current.some(r=>r[0]===latestTeam&&r[1]===team)){excluded.push({player:member.name,reason:'No offensive involvement in the latest completed current-team game; starting role is not established.'});continue;}
    if(member.position==='QB'&&(average(current.slice(0,3).map(r=>Number(r[8])||0))<15||Number(current[0]?.[8]||0)<15)){excluded.push({player:member.name,reason:'Recent passing attempts do not support a starting-quarterback projection.'});continue;}
   }
   // Shrunk recent role, not a fabricated benefit for joining a new team.
   const historicMinutes=weighted(logs.map(r=>r[2]),w),recentMinutes=average(logs.slice(0,10).map(r=>r[2]));
   const minutes=sport==='nba'?clamp((recentMinutes*10+historicMinutes*10)/20,0,40):null;
   const role=sport==='nba'&&historicMinutes>0?clamp(minutes!/historicMinutes,.8,1.2):1;
   for(let metric=0;metric<data.metrics.length;metric++){
    if(sport==='nfl'&&(metric===0||metric===4)&&member.position!=='QB')continue;
    if(sport==='nfl'&&(metric===2||metric===3)&&(!['WR','TE','RB','FB'].includes(member.position)||average(current.slice(0,3).map(r=>Number(r[10])||0))<2))continue;
    if(sport==='nfl'&&metric===1&&average(current.slice(0,3).map(r=>Number(r[9])||0))<3)continue;
    const values=logs.map(r=>Number(r[metric+3])),mean=weighted(values,w),factor=opponents.get(`${opponent}:${metric}`)||1,scaled=values.map(v=>v*factor*role);
    // Threshold policy is fixed BEFORE seeing either target: lower quartile,
    // rounded down to a normal milestone. No target-driven line adjustment.
    const step=sport==='nba'?[5,2,2,1][metric]:[25,10,10,1,1][metric];
    const threshold=Math.floor(quantile(scaled,w,.25)/step)*step;
    if(threshold<step)continue;
    const successes=scaled.map(v=>v>=threshold?1:0),rate=weighted(successes,w);
    // Two effective pseudo-observations centred on 50%, preventing 100% claims.
    const probability=(rate*effective+1)/(effective+2);
    if(probability<.68||probability>.95)continue;
    // NFL weekly files contain offensive involvement, not guaranteed active DNPs.
    // Reject a disappearing role rather than dropping the zero/low games.
    if(sport==='nfl'&&average(logs.slice(0,3).map(r=>Number(r[metric+3])))<mean*.45)continue;
    const h2h=logs.filter(r=>opponentId(data,r)===opponent),lastFive=logs.slice(0,5).map(r=>Number(r[metric+3]));
    const warnings=['Conditional on playing the projected role; game-day active status is not confirmed.'];
    if(!current.length)warnings.push('No current-season regular-season boxes yet. Preseason is excluded.');
    if(logs[0][1]!==team)warnings.push('New team: prior-team production is transferred provisionally; the new role is unvalidated.');
    if(sport==='nfl')warnings.push('Weekly offensive boxes omit some active games with no recorded involvement; participation risk can be understated.');
    candidates.push({id:`${fixture.id}:${member.id}:${metric}`,playerId:member.id,player:member.name,team,opponent,metric,stat:data.metrics[metric],threshold,label:`${member.name} ${threshold}+ ${data.metrics[metric]}`,probability,mean:mean*factor*role,lastFive,currentMean:current.length?average(current.map(r=>Number(r[metric+3]))):null,currentGames:current.length,historyGames:logs.length,effectiveGames:effective,h2hGames:h2h.length,h2hMean:h2h.length?average(h2h.map(r=>Number(r[metric+3]))):null,opponentFactor:factor,roleFactor:role,projectedMinutes:minutes,reason:`${member.name} averaged ${mean.toFixed(1)} ${data.metrics[metric]} across ${logs.length} earlier regular-season games (recent games weighted more). Last five: ${lastFive.join(', ')}. Opponent team allowance changes the projection by ${((factor-1)*100).toFixed(1)}%, shrunk toward league average. ${h2h.length?`Against this opponent: ${h2h.length} games, ${average(h2h.map(r=>Number(r[metric+3]))).toFixed(1)} average; shown as context, not an extra small-sample boost.`:'No earlier opponent matchup; no head-to-head boost.'} The fixed lower-quartile milestone gives ${(probability*100).toFixed(1)}% conditional chance.`,warnings});
   }
  }
 }
 return {candidates:candidates.sort((a,b)=>b.probability-a.probability||a.id.localeCompare(b.id)),excluded};
}
function ranks(a:number[]){const rows=a.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out:number[]=[];for(let i=0;i<rows.length;){let j=i+1;while(j<rows.length&&rows[j].v===rows[i].v)j++;for(let k=i;k<j;k++)out[rows[k].i]=(i+j-1)/2;i=j;}return out;}
function pearson(a:number[],b:number[]){const am=average(a),bm=average(b);let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){const x=a[i]-am,y=b[i]-bm;ab+=x*y;aa+=x*x;bb+=y*y;}return aa*bb>0?ab/Math.sqrt(aa*bb):0;}
export function pairCorrelation(data:SgpDataset,a:SgpCandidate,b:SgpCandidate,before:string,sport:SgpSport){
 const left=priorLogs(data,a.playerId,before,sport).slice(0,sport==='nba'?160:60),right=new Map(priorLogs(data,b.playerId,before,sport).slice(0,sport==='nba'?160:60).map(r=>[r[0],r]));
 const x:number[]=[],y:number[]=[];for(const l of left){const r=right.get(l[0]);if(!r)continue;const relationship=l[1]===r[1];if(relationship!==(a.team===b.team))continue;x.push(Number(l[a.metric+3]));y.push(Number(r[b.metric+3]));}
 const n=x.length;
 // A Gaussian copula with tied midranks. Sparse correlations shrink to zero;
 // missing dependencies are explicitly counted, never presented as measured.
 const rho=n>=12?2*Math.sin(Math.PI*pearson(ranks(x),ranks(y))/6)*n/(n+30):0;
 return {rho:clamp(rho,-.9,.9),n,measured:n>=12};
}
export function cholesky(matrix:number[][]):number[][]|null {const n=matrix.length,L=Array.from({length:n},()=>Array(n).fill(0));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let sum=matrix[i][j];for(let k=0;k<j;k++)sum-=L[i][k]*L[j][k];if(i===j){if(sum<=1e-10)return null;L[i][j]=Math.sqrt(sum);}else L[i][j]=sum/L[j][j];}return L;}
export function correlationMatrix(data:SgpDataset,candidates:SgpCandidate[],before:string,sport:SgpSport){
 const n=candidates.length,matrix:number[][]=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0)),pairs:{i:number;j:number;n:number;rho:number;measured:boolean}[]=[];
 for(let i=0;i<n;i++)for(let j=0;j<i;j++){const p=pairCorrelation(data,candidates[i],candidates[j],before,sport);matrix[i][j]=matrix[j][i]=p.rho;pairs.push({i,j,...p});}
 let shrink=1,L=cholesky(matrix);while(!L&&shrink>.01){shrink*=.8;L=cholesky(matrix.map((r,i)=>r.map((v,j)=>i===j?1:v*shrink)));}return {L:L||matrix.map((r,i)=>r.map((_,j)=>i===j?1:0)),pairs,shrink};
}
function random(seed:number){let t=seed>>>0;return()=>{t+=0x6D2B79F5;let r=Math.imul(t^t>>>15,t|1);r^=r+Math.imul(r^r>>>7,r|61);return ((r^r>>>14)>>>0)/4294967296;};}
export function simulationMasks(candidates:SgpCandidate[],L:number[][],samples=65536,seed=27941){
 const rnd=random(seed),n=candidates.length,masks=candidates.map(()=>new Uint32Array(Math.ceil(samples/32))),z=new Float64Array(n);
 for(let s=0;s<samples;s++){for(let i=0;i<n;i+=2){const radius=Math.sqrt(-2*Math.log(Math.max(1e-12,rnd()))),theta=2*Math.PI*rnd();z[i]=radius*Math.cos(theta);if(i+1<n)z[i+1]=radius*Math.sin(theta);}for(let i=0;i<n;i++){let value=0;for(let j=0;j<=i;j++)value+=L[i][j]*z[j];if(normalCdf(value)<=candidates[i].probability)masks[i][s>>>5]|=1<<(s&31);}}
 return masks;
}
function popcount(v:number){v-=v>>>1&0x55555555;v=(v&0x33333333)+(v>>>2&0x33333333);return ((v+(v>>>4)&0x0F0F0F0F)*0x01010101)>>>24;}
export function maskHits(indices:number[],masks:Uint32Array[],samples=65536){if(!indices.length)return samples;let count=0;for(let w=0;w<masks[0].length;w++){let bits=0xFFFFFFFF;for(const i of indices)bits&=masks[i][w];count+=popcount(bits);}return count;}
export function wilson(hits:number,n:number):[number,number]{const z=1.96,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,e=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-e),Math.min(1,c+e)];}
export function jointSummary(indices:number[],candidates:SgpCandidate[],masks:Uint32Array[],correlation:ReturnType<typeof correlationMatrix>,samples=65536):SgpJoint{
 const hits=maskHits(indices,masks,samples),p=hits/samples,pairs=correlation.pairs.filter(r=>indices.includes(r.i)&&indices.includes(r.j)),measured=pairs.filter(p=>p.measured);
 return {probability:p,fairOdds:hits>=25?1/p:null,simulationInterval:wilson(hits,samples),hits,samples,independentProbability:indices.reduce((s,i)=>s*candidates[i].probability,1),measuredPairs:measured.length,totalPairs:pairs.length,minPairGames:measured.length?Math.min(...measured.map(p=>p.n)):0,shrink:correlation.shrink,unresolved:hits<25};
}
export function compatibleProps(a:SgpCandidate,b:SgpCandidate,sport:SgpSport){
 if(a.id===b.id)return false;if(a.playerId!==b.playerId)return true;
 if(a.metric===b.metric)return false;
 // Do not charge probability twice for logically nested milestones.
 if(sport==='nfl'&&((a.metric===3&&a.threshold===1&&b.metric===2&&b.threshold>0)||(b.metric===3&&b.threshold===1&&a.metric===2&&a.threshold>0)))return false;
 if(sport==='nba'&&((a.metric===0&&b.metric===3&&a.threshold<=3*b.threshold)||(b.metric===0&&a.metric===3&&b.threshold<=3*a.threshold)))return false;
 return true;
}
export function suggestedSgps(data:SgpDataset,candidates:SgpCandidate[],before:string,sport:SgpSport){
 const correlation=correlationMatrix(data,candidates,before,sport),masks=simulationMasks(candidates,correlation.L);
 return (['40','jackpot'] as const).map(id=>{
  const min=id==='40'?40:1000,max=id==='40'?60:Infinity,target=1/min,indices:number[]=[];let hits=65536;
  // Greedy research search: append the supported leg that preserves the greatest
  // joint chance. Candidate thresholds never change in response to the target.
  // No claim that a greedy subset search is a global optimum.
  while(indices.length<candidates.length&&hits/65536>target){let best=-1,bestHits=-1;for(let i=0;i<candidates.length;i++){if(indices.includes(i)||indices.some(j=>!compatibleProps(candidates[i],candidates[j],sport)))continue;const count=maskHits([...indices,i],masks);if(id==='40'&&count/65536<1/max)continue;if(count>bestHits&&count<hits){best=i;bestHits=count;}}if(best<0)break;indices.push(best);hits=bestHits;}
  const joint=indices.length?jointSummary(indices,candidates,masks,correlation):null,odds=joint?.fairOdds,targetReached=!!odds&&odds>=min&&odds<=max;
  const reason=!indices.length?'No player milestones passed the history, role and availability checks.':targetReached?'Target reached using the fixed, data-supported milestones. Joint chance includes measured and shrunk game-level dependencies.':`Target not reached with the supported player milestones${joint?.unresolved?'; too few simulated joint successes for a stable price':''}. No tougher line or low-probability leg was added to force the target.`;
  return {id,title:id==='40'?'40–60 odds':'Jackpot · 1000+',legs:indices.map(i=>candidates[i]),joint,targetReached,reason} satisfies SgpSuggestion;
 });
}
export function sgpPrefixes(data:SgpDataset,candidates:SgpCandidate[],before:string,sport:SgpSport){
 const correlation=correlationMatrix(data,candidates,before,sport),masks=simulationMasks(candidates,correlation.L),indices:number[]=[],prefixes:SgpPrefixSet['prefixes']=[];let hits=65536;
 while(indices.length<candidates.length){let best=-1,bestHits=-1;for(let i=0;i<candidates.length;i++){if(indices.includes(i)||indices.some(j=>!compatibleProps(candidates[i],candidates[j],sport)))continue;const count=maskHits([...indices,i],masks);if(count>bestHits&&count<hits){best=i;bestHits=count;}}if(best<0)break;indices.push(best);hits=bestHits;const joint=jointSummary(indices,candidates,masks,correlation);if(joint.unresolved)break;prefixes.push({indices:[...indices],joint});}
 return prefixes;
}
export function aggregateSgps(sets:SgpPrefixSet[]):DailySgpSuggestion[]{
 const unique=[...new Map(sets.filter(s=>s.fixture.sport==='nba'||s.fixture.sport==='nfl').map(s=>({...s,prefixes:s.prefixes.filter(p=>!p.joint.unresolved&&p.joint.probability>0&&p.joint.probability<1&&p.joint.fairOdds!==null&&Number.isFinite(p.joint.fairOdds)&&p.joint.fairOdds>1&&new Set(p.indices).size===p.indices.length&&p.indices.every(i=>i>=0&&i<s.candidates.length))})).map(s=>[`${s.fixture.sport}:${s.fixture.id}`,s])).values()];
 return (['40','jackpot'] as const).map(id=>{
  const min=id==='40'?40:1000,max=id==='40'?60:Infinity,minimum=Math.log(min),maximum=Math.log(max),width=.002;
  type State={cost:number;probability:number;choices:{game:number;prefix:number}[]};let states=new Map<number,State>([[0,{cost:0,probability:1,choices:[]}]]),best:State|null=null;
  // Dynamic search over strongest compatible within-game prefixes. Bins bound
  // computation, not the number of games/legs. Exact products verify targets.
  for(let g=0;g<unique.length;g++){
   const next=new Map(states);for(const state of states.values())for(let p=0;p<unique[g].prefixes.length;p++){
    const joint=unique[g].prefixes[p].joint;if(joint.unresolved||!joint.fairOdds||joint.probability<=0||joint.probability>=1)continue;
    const probability=state.probability*joint.probability,cost=-Math.log(probability);if(cost>maximum+1e-12||best&&cost>=best.cost)continue;
    const value:State={cost,probability,choices:[...state.choices,{game:g,prefix:p}]},product=1/probability;
    if(cost>=minimum&&product>=min&&product<=max){if(!best||cost<best.cost)best=value;continue;}
    const bucket=Math.floor(cost/width),old=next.get(bucket);if(!old||cost<old.cost)next.set(bucket,value);
   }states=next;
  }
  const choices=best?.choices||unique.flatMap((s,game)=>s.prefixes.length?[{game,prefix:s.prefixes.length-1}]:[]),groups=choices.map(c=>{const s=unique[c.game],p=s.prefixes[c.prefix];return {fixture:s.fixture,legs:p.indices.map(i=>s.candidates[i]),joint:p.joint};}),probability=groups.length?groups.reduce((p,g)=>p*g.joint.probability,1):null,fairOdds=probability&&Number.isFinite(1/probability)?1/probability:null,targetReached=!!best&&fairOdds!==null&&fairOdds>=min&&fairOdds<=max;
  return {id,groups,probability,fairOdds,targetReached,reason:!groups.length?'No supported upcoming NBA/NFL player props on this date.':targetReached?'Daily target reached using the strongest supported per-game prefixes. Correlations stay inside each game; separate games are multiplied under an independence assumption.':'Target not reached with the supported fixed milestones. The available supported groups are shown; no harder line or low-probability prop was introduced.'};
 });
}
