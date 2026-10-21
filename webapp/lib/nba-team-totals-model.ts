import {days,localDay,normalCdf} from './models';
import type {Fixture,NbaGame} from './types';
import type {ResearchFixture,ResearchPick,ResearchCombo} from './specialist-types';
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export function nbaTeamTotals(games:NbaGame[],fixture:Fixture,date:string,teamNames:Record<string,string>={}):ResearchFixture{
 const season=Number(date.slice(0,4))+(Number(date.slice(5,7))>=7?1:0),history=games.filter(g=>g.completed&&g.hp!==null&&g.ap!==null&&g.hp>0&&g.ap>0&&g.season>=season-4&&g.season<=season&&localDay(g.start)<date),rows=history.map(g=>({...g,w:2**(-days(date,localDay(g.start))/240)}));
 const base:ResearchFixture={id:fixture.id,start:fixture.start,home:fixture.home.name,away:fixture.away.name,status:fixture.status,completed:fixture.completed,summary:'',analysis:[],picks:[],combinations:[],form:[fixture.home,fixture.away].map(t=>({team:t.name,rows:history.filter(g=>g.home===t.id||g.away===t.id).sort((a,b)=>b.start.localeCompare(a.start)).slice(0,5).map(g=>({day:localDay(g.start),opponent:teamNames[g.home===t.id?g.away:g.home]||(g.home===t.id?g.away:g.home),score:g.home===t.id?`${g.hp}–${g.ap}`:`${g.ap}–${g.hp}`,competition:g.season===season?'Current NBA season':`NBA ${g.season-1}–${String(g.season).slice(-2)}`}))}))};
 if(history.length<300||[fixture.home,fixture.away].some(t=>history.filter(g=>g.home===t.id||g.away===t.id).length<12)){base.summary='Insufficient earlier NBA scoring history.';return base;}
 const weight=rows.reduce((s,g)=>s+g.w,0),mean=rows.reduce((s,g)=>s+g.w*(g.hp!+g.ap!)/2,0)/weight,venue=rows.reduce((s,g)=>s+g.w*(g.neutral?0:g.hp!-g.ap!),0)/(2*rows.filter(g=>!g.neutral).reduce((s,g)=>s+g.w,0)||1),ids=[...new Set(rows.flatMap(g=>[g.home,g.away]))],off:Record<string,number>={},def:Record<string,number>={};
 for(const id of ids){off[id]=0;def[id]=0;}
 for(let iter=0;iter<20;iter++){
  for(const id of ids){let a=0,b=0,w=25;for(const g of rows){if(g.home===id){a+=g.w*(g.hp!-mean-(g.neutral?0:venue)-def[g.away]);b+=g.w*(g.ap!-mean+(g.neutral?0:venue)-off[g.away]);w+=g.w;}if(g.away===id){a+=g.w*(g.ap!-mean+(g.neutral?0:venue)-def[g.home]);b+=g.w*(g.hp!-mean-(g.neutral?0:venue)-off[g.home]);w+=g.w;}}off[id]=a/w;def[id]=b/w;}
 }
 const h=fixture.home.id,a=fixture.away.id,pred=(home:string,away:string,neutral:boolean)=>[mean+off[home]+def[away]+(neutral?0:venue),mean+off[away]+def[home]-(neutral?0:venue)],projected=pred(h,a,fixture.neutral);
 let v=0,cov=0;for(const g of rows){const p=pred(g.home,g.away,g.neutral),eh=g.hp!-p[0],ea=g.ap!-p[1];v+=g.w*(eh*eh+ea*ea)/2;cov+=g.w*eh*ea;}
 const variance=v/weight,sigma=Math.sqrt(Math.max(121,variance)*1.12),rho=clamp(cov/(weight*variance+30*variance),-.25,.6),matchup=`${fixture.away.name} at ${fixture.home.name}`;
 base.scoreDistribution={kind:'normal',homeMean:projected[0],awayMean:projected[1],homeSigma:sigma,awaySigma:sigma,correlation:rho};
 base.summary=`Projected team points: ${fixture.away.name} ${projected[1].toFixed(1)} · ${fixture.home.name} ${projected[0].toFixed(1)}`;
 base.analysis=[`Opponent-adjusted attack and defence fitted to ${history.length} earlier regular-season results from the last four seasons and the current season. Recent results receive more weight (240-day half-life); home scoring advantage is learned from results. Overtime is included.`, `Prediction spread ${sigma.toFixed(1)} points per team; same-game scoring correlation ${rho.toFixed(2)}. Both-team combinations use a joint scoring simulation rather than multiplying their individual chances.`,`Team totals are a separate scoring model. Player availability, confirmed lineups and roster changes are not quantitatively adjusted in this model; this is an experimental projection, not a calibrated certainty or a quoted FanDuel line.`, `Historical cutoff: before ${date}. Current-season results in training: ${history.filter(g=>g.season===season).length}.`];
 for(const [i,t] of [fixture.home,fixture.away].entries()){
  const mu=projected[i],teamRows=history.filter(g=>g.home===t.id||g.away===t.id),current=teamRows.filter(g=>g.season===season).length;
  const lines=[...new Set([Math.floor(mu-.55*sigma)+.5,Math.floor(mu)+.5,Math.floor(mu+.55*sigma)+.5])];
  for(const line of lines)for(const side of ['over','under'] as const){const p=side==='under'?normalCdf((line-mu)/sigma):1-normalCdf((line-mu)/sigma);if(p<.5||p>.88)continue;const label=`${t.name} ${side} ${line} team points`;base.picks.push({id:`${fixture.id}:${t.id}:${side}:${line}`,fixtureId:fixture.id,matchup,label,team:t.id,side,line,probability:p,reason:`${t.name} projects at ${mu.toFixed(1)} points against ${i===0?fixture.away.name:fixture.home.name}; ${teamRows.length} earlier team games (${current} current season), with opponent defence and venue adjustment. ${side==='over'?'Above':'Below'} ${line} in the predictive scoring distribution: ${(p*100).toFixed(1)}%. This alternative line is a research threshold, not a confirmed sportsbook offer.`});}
 }
 const combos:ResearchCombo[]=base.picks.map(p=>({id:p.id,fixtureId:fixture.id,picks:[p],probability:p.probability}));
 const pairs=base.picks.filter(p=>p.team===h).flatMap(x=>base.picks.filter(p=>p.team===a).map(y=>({x,y,hits:0})));
 let seed=713;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};const n=32768;
 for(let i=0;i<n;i++){const radius=Math.sqrt(-2*Math.log(random())),angle=2*Math.PI*random(),z=radius*Math.cos(angle),z2=rho*z+Math.sqrt(1-rho*rho)*radius*Math.sin(angle),hs=projected[0]+sigma*z,as=projected[1]+sigma*z2;for(const p of pairs)if((p.x.side==='over'?hs>p.x.line!:hs<p.x.line!)&&(p.y.side==='over'?as>p.y.line!:as<p.y.line!))p.hits++;}
 for(const p of pairs){const probability=Math.min(p.x.probability,p.y.probability,(p.hits+.5)/(n+1));if(probability>.25)combos.push({id:`${p.x.id}|${p.y.id}`,fixtureId:fixture.id,picks:[p.x,p.y],probability});}
 base.combinations=combos;return base;
}
