import { build } from 'esbuild';
import { readFile,writeFile } from 'node:fs/promises';
const built=await build({stdin:{contents:'export * from "./lib/football-market-model";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')),seed=JSON.parse(await readFile('lib/football-markets-seed.json','utf8'));
const evaluation={modelVersion:m.FOOTBALL_MARKET_VERSION,season:'2025–26',cornerLine:8.5,method:'Walk-forward development check. Each fixture uses strictly earlier dates only; no same-day or future results. Individual-market probabilities, not slip calibration. All parameters and the corner line were fixed before this check.',leagues:{}};
for(const sport of ['epl','laliga','seriea']){
 const games=seed.leagues[sport].games,rows={corners:[],btts:[]};
 for(const [i,g] of games.filter(g=>g.season===2026).entries()){
  const fixture={id:'evaluation-'+i,sport,day:g.day,start:g.day+'T19:00Z',home:{id:g.home,name:g.home,abbr:g.home},away:{id:g.away,name:g.away,abbr:g.away},status:'Scheduled',completed:false,neutral:false,preseason:false},forecast=m.footballMarketForecast(games,fixture,g.day,8.5,Date.parse(g.day+'T00:00Z')),history=m.footballMarketHistory(games,g.day);
  for(const kind of ['corners','btts']){
   const side=kind==='corners'?'over':'yes',option=forecast.options.find(o=>o.market===kind&&o.side===side);if(!option)continue;
   const usable=history.filter(r=>kind==='btts'||r.hc!==null&&r.ac!==null);let weight=0,hits=0;
   for(const r of usable){const w=2**(-(Date.parse(g.day)-Date.parse(r.day))/86400000/180);weight+=w;hits+=w*Number(kind==='btts'?r.hp>0&&r.ap>0:r.hc+r.ac>8.5);}
   const y=Number(kind==='btts'?g.hp>0&&g.ap>0:g.hc+g.ac>8.5);rows[kind].push({p:option.probability,y,baseline:(hits+1)/(weight+2)});
  }
 }
 const metrics=values=>({games:values.length,brier:values.reduce((s,r)=>s+(r.p-r.y)**2,0)/values.length,baselineBrier:values.reduce((s,r)=>s+(r.baseline-r.y)**2,0)/values.length,logLoss:values.reduce((s,r)=>s-r.y*Math.log(Math.max(1e-9,r.p))-(1-r.y)*Math.log(Math.max(1e-9,1-r.p)),0)/values.length,accuracy:values.filter(r=>Number(r.p>=.5)===r.y).length/values.length});
 evaluation.leagues[sport]={corners:metrics(rows.corners),btts:metrics(rows.btts)};
 console.log(sport,JSON.stringify(evaluation.leagues[sport]));
}
await writeFile('lib/football-markets-evaluation.json',JSON.stringify(evaluation,null,2)+'\n');
