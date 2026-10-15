import type { Sport } from './types';
export const COMPETITIONS:Record<Sport,{label:string;short:string;path:string;providerId:number;kind:'margin'|'football';footballCode?:string;season:number}>={
  nba:{label:'NBA',short:'NBA',path:'basketball/nba',providerId:4,kind:'margin',season:2027},
  nfl:{label:'NFL',short:'NFL',path:'football/nfl',providerId:2,kind:'margin',season:2026},
  nhl:{label:'NHL',short:'NHL',path:'hockey/nhl',providerId:6,kind:'margin',season:2027},
  epl:{label:'Premier League',short:'EPL',path:'soccer/eng.1',providerId:11,kind:'football',footballCode:'E0',season:2027},
  laliga:{label:'La Liga',short:'La Liga',path:'soccer/esp.1',providerId:14,kind:'football',footballCode:'SP1',season:2027},
  seriea:{label:'Serie A',short:'Serie A',path:'soccer/ita.1',providerId:15,kind:'football',footballCode:'I1',season:2027},
};
export const SPORTS=Object.keys(COMPETITIONS) as Sport[];
export function isFootball(sport:Sport){return COMPETITIONS[sport].kind==='football';}
export function selectedSports(filter:string):Sport[]{return filter==='all'?SPORTS:filter==='football'?SPORTS.filter(isFootball):[filter as Sport];}
export function canonicalAbbr(sport:Sport,value:string):string{
  const aliases:Partial<Record<Sport,Record<string,string>>>={
    nba:{NYK:'NY',GSW:'GS',SAS:'SA',NOP:'NO',WAS:'WSH',UTA:'UTAH',PHO:'PHX'},
    nfl:{LA:'LAR',JAC:'JAX',WSH:'WAS'},
    nhl:{LA:'LAK',SJ:'SJS',TB:'TBL',NJ:'NJD',MON:'MTL',WAS:'WSH',UTAH:'UTA',NAS:'NSH'},
  };return aliases[sport]?.[value]||value;
}
