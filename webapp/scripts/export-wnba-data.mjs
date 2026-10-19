// Free public feeds only. Run from webapp/; raw files stay in ignored work/.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
const output=await build({stdin:{contents:'export * from "./lib/wnba-data";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false}),m=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
await mkdir('work/wnba',{recursive:true});
function download(url){return execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','45','--retry','2',url],{encoding:'utf8',maxBuffer:30e6});}
let data;
for(let year=2022;year<=2026;year++){
 const url=`https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_wnba_player_boxscores/player_box_${year}.csv`,raw=process.argv.includes('--cached')?await readFile(`/private/tmp/wnba-${year}.csv`,'utf8'):download(url),next=m.parseWnbaPlayers(raw,year);await writeFile(`work/wnba/${year}.csv`,raw);data=data?m.mergeWnbaData(data,next):next;console.log(year,next.games.length,'games');
}
const base='https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/';
const schedule=JSON.parse(process.argv.includes('--cached')?await readFile('/private/tmp/wnba-schedule.json','utf8'):download(base+'teams/129689/schedule?season=2026&seasontype=3'));
const fixtures=m.parseWnbaFinals(schedule),rosters={};for(const id of new Set(fixtures.flatMap(f=>[f.home.id,f.away.id]))){const payload=JSON.parse(process.argv.includes('--cached')?await readFile(`/private/tmp/wnba-roster-${id==='20'?'atl':'gs'}.json`,'utf8'):download(base+`teams/${id}/roster`));rosters[id]=m.parseWnbaRoster(payload);}
const news=[];for(const id of Object.keys(rosters)){const payload=JSON.parse(download(base+`news?team=${id}&limit=8`));for(const a of payload.articles||[]){const url=a.links?.web?.href;if(a.headline&&/^https:\/\/(www\.)?(espn\.com|wnba\.com)\//.test(url))news.push({title:a.headline,url,publishedAt:a.published||null});}}
const seed={...data,snapshot:new Date().toISOString(),rosters,fixtures,news:[...new Map(news.map(n=>[n.url,n])).values()]};await writeFile('lib/wnba-seed.json',JSON.stringify(seed)+'\n');console.log(Object.keys(seed.players).length,'players;',Object.values(seed.players).reduce((s,p)=>s+p.logs.length,0),'boxes;',fixtures.length,'Finals fixtures');
