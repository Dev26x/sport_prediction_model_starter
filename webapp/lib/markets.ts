import { americanToDecimal, localDay } from './models';
import type { Fixture, Quote, Sport } from './types';
import { canonicalAbbr, isFootball } from './competitions';

const NBA_ALIASES:Record<string,string>={NYK:'NY',GSW:'GS',SAS:'SA',NOP:'NO',WAS:'WSH',UTA:'UTAH',PHO:'PHX'};
const PL_ALIASES:Record<string,string>={
 'manchestercity':'Man City','mancity':'Man City','manchesterunited':'Man United','manunited':'Man United','manutd':'Man United',
 'tottenhamhotspur':'Tottenham','tottenham':'Tottenham','spurs':'Tottenham','wolverhamptonwanderers':'Wolves','wolverhampton':'Wolves','wolves':'Wolves',
 'nottinghamforest':'Nott\'m Forest','nottmforest':'Nott\'m Forest','nottforest':'Nott\'m Forest','newcastleunited':'Newcastle','newcastle':'Newcastle',
 'westhamunited':'West Ham','westham':'West Ham','brightonhovealbion':'Brighton','brightonandhovealbion':'Brighton','brighton':'Brighton',
 'leedsunited':'Leeds','leeds':'Leeds','leicestercity':'Leicester','leicester':'Leicester','ipswichtown':'Ipswich','ipswich':'Ipswich',
 'coventrycity':'Coventry','coventry':'Coventry','bournemouth':'Bournemouth','afcbournemouth':'Bournemouth',
 'hullcity':'Hull','hull':'Hull','atleticomadrid':'Ath Madrid','atletico':'Ath Madrid','athleticclub':'Ath Bilbao','athleticbilbao':'Ath Bilbao','athletic':'Ath Bilbao',
 'realsociedad':'Sociedad','sociedad':'Sociedad','realbetis':'Betis','betis':'Betis','celtavigo':'Celta','celta':'Celta','rayovallecano':'Vallecano','rayo':'Vallecano','vallecano':'Vallecano',
 'deportivoalaves':'Alaves','alaves':'Alaves','rcdmallorca':'Mallorca','rcdespanyol':'Espanol','espanyol':'Espanol','espanol':'Espanol','realoviedo':'Oviedo','deportivolacoruna':'La Coruna','lacoruna':'La Coruna','racingsantander':'Santander','racing':'Santander','deportivo':'La Coruna','malagacf':'Malaga','laspalmas':'Las Palmas',
 'acmilan':'Milan','milan':'Milan','intermilan':'Inter','internazionale':'Inter','inter':'Inter','asroma':'Roma','roma':'Roma','hellasverona':'Verona','verona':'Verona','uslecce':'Lecce',
};
export function plName(value:string) {const clean=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'').replace(/^fc|fc$/g,'');return PL_ALIASES[clean]||value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/^FC | FC$/g,'');}
function sameTeam(provider:any,fixture:Fixture,side:'home'|'away') {
  if(!isFootball(fixture.sport)){return canonicalAbbr(fixture.sport,provider.abbreviation)===canonicalAbbr(fixture.sport,fixture[side].abbr);}
  return [provider.name,provider.team_name,provider.name_full,provider.display_name,provider.full_name].filter(Boolean).some(n=>plName(n).toLowerCase()===plName(fixture[side].name).toLowerCase());
}
export function normalizeQuotes(payload:any, fixtures:Fixture[], book:string, observedAt:string, sport:Sport):Quote[] {
  const result:Quote[]=[];
  for(const event of payload.events||[]) {
    const start=Date.parse(event.event_date);
    if(!Number.isFinite(start)||start<=Date.parse(observedAt)||start<=Date.now())continue;
    const home=(event.teams||[]).find((t:any)=>t.is_home),away=(event.teams||[]).find((t:any)=>t.is_away);
    if(!home||!away)continue;
    const matches=fixtures.filter(f=>f.sport===sport&&localDay(f.start)===localDay(event.event_date)&&Math.abs(Date.parse(f.start)-start)<=3*3600000&&sameTeam(home,f,'home')&&sameTeam(away,f,'away'));
    if(matches.length!==1)continue;
    const fixture=matches[0];
    for(const m of event.markets||[]) {
      if(m.period_id!==0||![1,2,3].includes(m.market_id))continue;
      if(isFootball(sport)&&m.market_id===2||!isFootball(sport)&&m.market_id===3)continue;
      const entries:{side:string;line:number|null;decimal:number;american:number;updatedAt:string}[]=[];
      for(const participant of m.participants||[]) {
        let side='';
        if(participant.type==='TYPE_TEAM') {if(String(participant.id)===String(home.team_id))side='home';if(String(participant.id)===String(away.team_id))side='away';}
        const label=String(participant.name||participant.description||'').toLowerCase();
        if(!side&&m.market_id===1&&isFootball(sport)&&(/draw|tie/.test(label)))side='draw';
        if(m.market_id===3) {if(label==='over')side='over';if(label==='under')side='under';}
        if(!side)continue;
        for(const line of participant.lines||[]) {
          const q=line.prices?.[book];if(!q||q.closed_at||q.is_main_line===false)continue;
          const updated=Date.parse(q.updated_at);if(!Number.isFinite(updated)||updated>Date.parse(observedAt))continue;
          const value=m.market_id===1?null:Number(line.value);
          if(value!==null&&(!Number.isFinite(value)||Math.abs(value%1)!==.5))continue;
          if(m.market_id===3&&value!==2.5)continue;
          try { entries.push({side,line:value,decimal:americanToDecimal(Number(q.price)),american:Number(q.price),updatedAt:q.updated_at}); }catch{}
        }
      }
      // Pair one unambiguous full market before removing bookmaker margin.
      const wanted=m.market_id===1?(isFootball(sport)?['home','draw','away']:['home','away']):m.market_id===2?['home','away']:['over','under'];
      if(entries.length!==wanted.length||!wanted.every(s=>entries.filter(e=>e.side===s).length===1))continue;
      if(m.market_id===2&&Math.abs(entries[0].line!+entries[1].line!)>1e-7)continue;
      const sum=entries.reduce((s,e)=>s+1/e.decimal,0);if(sum<.8||sum>1.5)continue;
      for(const e of entries)result.push({...e,fixtureId:fixture.id,market:m.market_id===1?'moneyline':m.market_id===2?'spread':'total',book,observedAt,marketProbability:(1/e.decimal)/sum});
    }
  }
  return result;
}
