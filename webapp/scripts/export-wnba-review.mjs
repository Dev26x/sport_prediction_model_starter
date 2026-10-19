// Run after exporting/retrieving public inputs. Never regenerate the immutable
// Game 1 forecast from postgame player data.
import { build } from 'esbuild';
import { readFile,writeFile } from 'node:fs/promises';
process.on('uncaughtException',e=>{console.error(e.message);process.exit(1);});
const b=await build({stdin:{contents:'export * from "./lib/wnba-data";export * from "./lib/wnba-review";',resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false}),m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const original=JSON.parse(await readFile('lib/wnba-game1-pregame.json','utf8'));if(original.suggestion.legs.length!==17||Date.parse(original.issuedAt)>=Date.parse(original.fixture.start))throw new Error('Original pregame archive is invalid.');
const base=JSON.parse(await readFile('lib/wnba-seed.json','utf8')),data=m.mergeWnbaData(base,m.parseWnbaPlayers(await readFile('work/wnba-review/current.csv','utf8'),2026)),fixtures=m.parseWnbaFinals(JSON.parse(await readFile('work/wnba-review/schedule.json','utf8'))),box=m.parseWnbaBox(JSON.parse(await readFile('work/wnba-review/game1.json','utf8')),fixtures[0]);
data.rosters={'20':m.parseWnbaRoster(JSON.parse(await readFile('work/wnba-review/roster-atl.json','utf8'))),'129689':m.parseWnbaRoster(JSON.parse(await readFile('work/wnba-review/roster-gs.json','utf8')))};
const payload={...base,...data,snapshot:new Date().toISOString(),fixtures,results:{...base.results,[box.fixtureId]:box}};await writeFile('lib/wnba-seed.json',JSON.stringify(payload)+'\n');console.log('Current snapshot includes verified Game 1; original 17-leg pregame archive retained unchanged.');
