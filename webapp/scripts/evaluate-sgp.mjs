// Conditional development check, NOT a betting/P&L backtest. Participant lists
// come from the completed holdout box, so this does not test availability/DNPs.
import { build } from 'esbuild';
import fs from 'node:fs';
const b=await build({entryPoints:['lib/sgp-model.ts'],bundle:true,platform:'node',format:'esm',write:false}),m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const report={modelVersion:m.SGP_MODEL_VERSION,method:'Walk-forward development check on 64 evenly spaced games in the last completed season per sport. Predictors use strictly earlier dates. Conditions on the holdout box participant list; does NOT test roster selection, DNPs, injuries, offered lines, executable SGP prices or profit. The samples are too small to calibrate long-shot SGP probabilities.',sports:{}};
for(const sport of ['nba','nfl']){
 const d=JSON.parse(fs.readFileSync(`lib/sgp-${sport}-seed.json`)),year=sport==='nba'?2026:2025,eligible=d.games.map((g,i)=>({g,i})).filter(x=>x.g[2]===year),sample=Array.from({length:64},(_,i)=>eligible[Math.floor(i*eligible.length/64)]);
 const byGame=new Map();for(const[id,p]of Object.entries(d.players))for(const log of p.logs){const a=byGame.get(log[0])||[];a.push({id,p,log});byGame.set(log[0],a);}
 let props=0,predicted=0,hits=0,brier=0,sgps=0,sgpHits=0,sgpPredicted=0;
 for(const {g,i} of sample){const actual=byGame.get(i)||[],rosters={};for(const {id,p,log}of actual){(rosters[log[1]]??=[]).push({id,name:p.name,position:p.position,injury:'',depth:99});}const fixture={id:g[0],sport,home:{id:g[3]},away:{id:g[4]}},out=m.playerCandidates(d,fixture,g[1],rosters),actualById=new Map(actual.map(a=>[a.id,a.log]));for(const c of out.candidates){const result=actualById.get(c.playerId)[c.metric+3]>=c.threshold?1:0;props++;predicted+=c.probability;hits+=result;brier+=(result-c.probability)**2;}
 const s=m.suggestedSgps(d,out.candidates,g[1],sport)[0];if(s.targetReached){sgps++;sgpPredicted+=s.joint.probability;if(s.legs.every(c=>actualById.get(c.playerId)[c.metric+3]>=c.threshold))sgpHits++;}
 }
 report.sports[sport]={season:year,games:sample.length,conditionalProps:props,meanPredicted:predicted/props,observedHitRate:hits/props,brier:brier/props,target40Sgps:sgps,target40PredictedWins:sgpPredicted,target40ObservedWins:sgpHits};console.log(sport,report.sports[sport]);
}
fs.writeFileSync('lib/sgp-validation.json',JSON.stringify(report,null,2)+'\n');
