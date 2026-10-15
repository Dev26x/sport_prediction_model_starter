import type { MatchCard,Sport } from './types';
import type { ResultRow,resultSummary } from './form';
export type ResearchNews={title:string;url:string;publishedAt:string|null;observedAt:string;source:string;note?:string;teamName?:string;teamCode?:string;playerName?:string;status?:string};
export type TeamResearch={id:string;name:string;lastFive:ResultRow[];season:ReturnType<typeof resultSummary>;home:ReturnType<typeof resultSummary>;away:ReturnType<typeof resultSummary>;historical:{season:string;summary:ReturnType<typeof resultSummary>}[]};
export type FixtureResearch={fixture:MatchCard;home:TeamResearch;away:TeamResearch;h2h:ResultRow[];analysis:string[];news:ResearchNews[];sourceCheckedAt:string|null;sourceMessages:string[];sources:{name:string;url:string;at:string|null}[]};
export type ResearchDashboard={date:string;asOf:string;fixtures:FixtureResearch[];generatedAt:string;healthMessages:string[]};
