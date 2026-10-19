import { Layers3,Ticket } from 'lucide-react';
export default function SgpModeSwitch({date,mode,sport='nba'}:{date:string;mode:'single'|'combined';sport?:'nba'|'nfl'}){
 return <nav className="sgp-mode-switch" aria-label="Player-prop builder mode"><a className={mode==='single'?'active':''} aria-current={mode==='single'?'page':undefined} href={`/sgp?${new URLSearchParams({date,sport})}`}><Ticket size={18}/><span><b>Single game</b><small>Research one fixture’s player props</small></span></a><a className={mode==='combined'?'active':''} aria-current={mode==='combined'?'page':undefined} href={`/sgp?${new URLSearchParams({date,mode:'combined',pool:'both'})}`}><Layers3 size={18}/><span><b>Best across games</b><small>NBA, NFL or both · one combined slip</small></span></a></nav>;
}
