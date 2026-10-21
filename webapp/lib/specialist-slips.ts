import type {ResearchCombo,ResearchFixture,ResearchSlip} from './specialist-types';
export const RESEARCH_TARGETS=[{id:'20',min:20,max:22},{id:'50',min:50,max:55},{id:'200',min:200,max:220},{id:'jackpot',min:1000,max:Infinity}];
// Search only independently researched candidates; never manufacture a line to fill a target.
export function specialistSlips(fixtures:ResearchFixture[],now=Date.now()):ResearchSlip[]{
 const games=fixtures.filter(f=>!f.completed&&!/postponed|cancell?ed|suspended|in progress|halftime/i.test(f.status)&&Date.parse(f.start)>now+300000).map(f=>f.combinations.filter(c=>c.suggestionEligible!==false&&c.picks.length>0&&c.picks.length<=10&&c.probability>0&&c.probability<1));
 type State={cost:number;groups:ResearchCombo[]};
 let states:State[]=[{cost:0,groups:[]}];
 // A bounded log-probability beam retains combinations across the whole payout range.
 for(const options of games){const bins=new Map<number,State[]>();for(const state of states)for(const c of [null,...options]){const next=c?{cost:state.cost-Math.log(c.probability),groups:[...state.groups,c]}:state;if(next.cost>12)continue;const bin=Math.floor(next.cost/.0025),bucket=bins.get(bin)||[];if(!bucket.some(x=>Math.abs(x.cost-next.cost)<1e-10))bucket.push(next);bucket.sort((a,b)=>a.cost-b.cost);bins.set(bin,bucket.slice(0,2));}states=[...bins.values()].flat();}
 return RESEARCH_TARGETS.map(t=>{const best=states.filter(s=>s.groups.length&&s.cost>=Math.log(t.min)-1e-10&&s.cost<=Math.log(t.max)+1e-10).sort((a,b)=>a.cost-b.cost||a.groups.flatMap(g=>g.picks).length-b.groups.flatMap(g=>g.picks).length)[0];return {target:t.id,picks:best?.groups.flatMap(g=>g.picks)||[],probability:best?Math.exp(-best.cost):null,odds:best?Math.exp(best.cost):null,reached:!!best};});
}
/** Same-fixture legs must have a joint model estimate; only separate games multiply. */
export function specialistEstimate(fixtures:ResearchFixture[],picks:ResearchCombo['picks']):{probability:number|null;odds:number|null}{
 if(!picks.length||new Set(picks.map(p=>p.id)).size!==picks.length)return {probability:null,odds:null};let probability=1;
 for(const id of new Set(picks.map(p=>p.fixtureId))){const selected=picks.filter(p=>p.fixtureId===id),f=fixtures.find(g=>g.id===id),group=f?.combinations.find(c=>c.picks.length===selected.length&&c.picks.every(p=>selected.some(x=>x.id===p.id)));if(!group)return {probability:null,odds:null};probability*=group.probability;}
 return {probability,odds:1/probability};
}
