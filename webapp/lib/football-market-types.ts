import type { Fixture,Option } from './types';
export type FootballSport='epl'|'laliga'|'seriea';
export type FootballMarket='corners'|'btts';
export type FootballMarketGame={day:string;home:string;away:string;hp:number;ap:number;hc:number|null;ac:number|null;season:number};
export type TeamMarketForm={name:string;games:number;currentGames:number;cornerGames:number;lastFive:{day:string;opponent:string;home:boolean;goalsFor:number;goalsAgainst:number;cornersFor:number|null;cornersAgainst:number|null}[]};
export type FootballMarketFixture={fixture:Fixture;asOf:string;home:TeamMarketForm;away:TeamMarketForm;expectedGoals:number[]|null;corners:{home:number;away:number;total:number;dispersion:number|null;history:number;lastResult:string}|null;options:Option[];notes:string[]};
export type FootballMarketBoard={date:string;today:string;line:number;league:string;fixtures:FootballMarketFixture[];needsRefresh:FootballSport[];sources:{sport:FootballSport;at:string;lastResult:string|null;games:number;corners:number;url:string}[];messages:string[];generatedAt:string;modelVersion:string};
