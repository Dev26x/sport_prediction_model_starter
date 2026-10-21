import {localDay} from './models';
import type {LeagueTable,ResearchGame,ResearchFixture,ResearchPick} from './specialist-types';
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
// Regularised Poisson attack/defence fit. Domestic games use their own scoring
// environment; European games link opponents across leagues in the same rating graph.
export function fitEuropeanStrength(history:ResearchGame[]){
 const leagueRows=new Map<string,ResearchGame[]>();for(const g of history){const list=leagueRows.get(g.league)||[];list.push(g);leagueRows.set(g.league,list);}
 const baseline=new Map([...leagueRows].map(([league,rows])=>[league,[(rows.reduce((n,g)=>n+g.hp,0)+20*1.6)/(rows.length+20),(rows.reduce((n,g)=>n+g.ap,0)+20*1.3)/(rows.length+20)]]));
 const ids=[...new Set(history.flatMap(g=>[g.home.id,g.away.id]))],attack:Record<string,number>={},defence:Record<string,number>={};for(const id of ids){attack[id]=0;defence[id]=0;}
 for(let iteration=0;iteration<60;iteration++){
  const ag:Record<string,number>={},dg:Record<string,number>={},ah:Record<string,number>={},dh:Record<string,number>={};for(const id of ids){ag[id]=-8*attack[id];dg[id]=-8*defence[id];ah[id]=8;dh[id]=8;}
  for(const g of history){const b=baseline.get(g.league)!,h=g.home.id,a=g.away.id,w=g.league==='uefa.champions'?1.5:1,lh=b[0]*Math.exp(attack[h]+defence[a]),la=b[1]*Math.exp(attack[a]+defence[h]);ag[h]+=w*(g.hp-lh);dg[a]+=w*(g.hp-lh);ah[h]+=w*lh;dh[a]+=w*lh;ag[a]+=w*(g.ap-la);dg[h]+=w*(g.ap-la);ah[a]+=w*la;dh[h]+=w*la;}
  for(const id of ids){attack[id]=clamp(attack[id]+.4*ag[id]/ah[id],-1,1);defence[id]=clamp(defence[id]+.4*dg[id]/dh[id],-1,1);}
 }
 return {attack,defence,baseline};
}
export function uclForecast(f:ResearchGame,results:ResearchGame[],tables:LeagueTable[],date:string):ResearchFixture{
 const startYear=Number(date.slice(0,4))-(Number(date.slice(5,7))<7?1:0),cutoff=`${startYear}-07-01`,history=results.filter(g=>g.completed&&localDay(g.start)<date&&Number.isFinite(g.hp)&&Number.isFinite(g.ap)&&g.hp>=0&&g.ap>=0),teamRows=(id:string,domestic:boolean)=>history.filter(g=>(g.home.id===id||g.away.id===id)&&(domestic?g.league!=='uefa.champions':g.league==='uefa.champions')&&(g.league==='nor.1'?g.start>=`${startYear}-01-01`:g.start>=cutoff));
 const form=(id:string)=>history.filter(g=>g.home.id===id||g.away.id===id).filter(g=>g.start>=cutoff).sort((a,b)=>b.start.localeCompare(a.start)).slice(0,5).map(g=>({day:localDay(g.start),opponent:g.home.id===id?g.away.name:g.home.name,score:g.home.id===id?`${g.hp}–${g.ap}`:`${g.ap}–${g.hp}`,competition:g.league}));
 const out:ResearchFixture={id:f.id,start:f.start,home:f.home.name,away:f.away.name,status:f.status,completed:f.completed,summary:'',analysis:[],picks:[],combinations:[],form:[{team:f.home.name,rows:form(f.home.id)},{team:f.away.name,rows:form(f.away.id)}]};
 const descriptors=[f.home,f.away].map(t=>({t,league:tables.find(l=>l.teams.some(x=>x.id===t.id)),dom:teamRows(t.id,true),euro:teamRows(t.id,false)}));
 if(descriptors.some(t=>!t.league||t.dom.length<3)){out.summary='Current-season domestic coverage is incomplete; no supported pick.';out.analysis=descriptors.map(t=>`${t.t.name}: ${t.dom.length} domestic results, ${t.euro.length} UCL results. ${t.league?.name||'Domestic league data unavailable.'}`);return out;}
 const training=history.filter(g=>g.league==='nor.1'?g.start>=`${startYear}-01-01`:g.start>=cutoff),strength=fitEuropeanStrength(training),euroBase=strength.baseline.get('uefa.champions')||[1.6,1.3],eh=clamp(euroBase[0]*Math.exp((strength.attack[f.home.id]||0)+(strength.defence[f.away.id]||0)),.3,4.5),ea=clamp(euroBase[1]*Math.exp((strength.attack[f.away.id]||0)+(strength.defence[f.home.id]||0)),.3,4.5);
 const poisson=(mu:number)=>{const p=[Math.exp(-mu)];for(let n=1;n<=20;n++)p.push(p[n-1]*mu/n);return p;},ph=poisson(eh),pa=poisson(ea);let hw=0,draw=0,aw=0,over15=0,over25=0,under35=0,btts=0,sum=0;
 for(let i=0;i<=20;i++)for(let j=0;j<=20;j++){const p=ph[i]*pa[j];sum+=p;if(i>j)hw+=p;else if(i===j)draw+=p;else aw+=p;if(i+j>1)over15+=p;if(i+j>2)over25+=p;if(i+j<4)under35+=p;if(i>0&&j>0)btts+=p;}
 const matchup=`${f.home.name} vs ${f.away.name}`,raw:[string,number][]=[[`${f.home.name} to win`,hw],[`Draw`,draw],[`${f.away.name} to win`,aw],[`${f.home.name} or draw`,hw+draw],[`${f.away.name} or draw`,aw+draw],[`Over 1.5 match goals`,over15],[`Over 2.5 match goals`,over25],[`Under 3.5 match goals`,under35],[`Both teams to score — Yes`,btts],[`Both teams to score — No`,sum-btts]];
 out.scoreDistribution={kind:'poisson',homeMean:eh,awayMean:ea};
 out.summary=`Projected goals: ${f.home.name} ${eh.toFixed(2)} · ${f.away.name} ${ea.toFixed(2)}`;
 const evidence=descriptors.map(t=>`${t.t.name}: ${t.dom.length} ${t.league!.name} results (${t.dom.reduce((s,g)=>s+(g.home.id===t.t.id?g.hp:g.ap),0)} scored, ${t.dom.reduce((s,g)=>s+(g.home.id===t.t.id?g.ap:g.hp),0)} conceded); ${t.euro.length} UCL results.`);
 out.analysis=[...evidence,`Regularised Poisson attack and defence ratings are fitted to current-season domestic and UCL results together. Each league has its own scoring baseline; European results connect opponents across leagues. Eight units of regularisation shrink small samples toward average, and UCL results have 1.5× training weight. ${training.length} earlier match results are included. Recent five results are shown below; they are part of season data, not counted twice.`, `A Poisson score model evaluates wins, draws, double chance, goals and BTTS. Each slip uses at most one market per fixture to avoid treating correlated soccer markets as independent. All results must predate ${date}.`,`Experimental current-season model: domestic league strength differences and opponent quality are not fully identified by scoring rates. Early UCL samples are small; percentages are uncalibrated estimates. Confirmed lineups, injuries and live bookmaker prices are not incorporated.`];
 out.picks=raw.map(([label,p],i):ResearchPick=>({id:`${f.id}:${i}`,fixtureId:f.id,matchup,label,probability:p/sum,reason:`${out.summary}. ${evidence.join(' ')} The score distribution gives ${label.toLowerCase()} a ${(p/sum*100).toFixed(1)}% chance. Opponent attack and defence are fitted within each league’s scoring environment, with European results linking leagues; cross-league strength remains uncertain.`})).filter(p=>p.probability>=.5&&p.probability<=.95).sort((x,y)=>y.probability-x.probability);
 out.combinations=out.picks.map(p=>({id:p.id,fixtureId:f.id,picks:[p],probability:p.probability}));return out;
}
