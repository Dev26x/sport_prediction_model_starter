/** Joint events evaluated on one score distribution, not by multiplying markets. */
export type ScoreDistribution=
 | {kind:'poisson';homeMean:number;awayMean:number}
 | {kind:'normal';homeMean:number;awayMean:number;homeSigma:number;awaySigma:number;correlation:number};
export type WinnerTotalProbability={winner:'home'|'away';side:'over'|'under';probability:number;winnerProbability:number;totalProbability:number};
export function winnerTotalProbabilities(model:ScoreDistribution,line:number):WinnerTotalProbability[]{
 if(!Number.isFinite(line)||line<=0||line%1!==.5)throw new Error('Choose a positive half-point total line.');
 if(![model.homeMean,model.awayMean].every(v=>Number.isFinite(v)&&v>0))throw new Error('Scoring projections must be positive finite numbers.');
 const counters=[0,0,0,0],wins=[0,0],totals=[0,0];let weight=0;
 const observe=(h:number,a:number,w:number)=>{const side=h+a>line?0:1;totals[side]+=w;weight+=w;if(h===a)return;const winner=h>a?0:1;wins[winner]+=w;counters[winner*2+side]+=w;};
 if(model.kind==='poisson'){
  if(Math.max(model.homeMean,model.awayMean)>10)throw new Error('Goal distribution exceeds the supported range.');
  const pmf=(mu:number)=>{const p=[Math.exp(-mu)];for(let i=1;i<=60;i++)p.push(p[i-1]*mu/i);return p;},h=pmf(model.homeMean),a=pmf(model.awayMean);
  for(let i=0;i<h.length;i++)for(let j=0;j<a.length;j++)observe(i,j,h[i]*a[j]);
 }else{
  if(![model.homeSigma,model.awaySigma].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(model.correlation)||Math.abs(model.correlation)>=1)throw new Error('Invalid joint scoring uncertainty.');
  let seed=150713;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
  for(let i=0;i<65536;i++){const r=Math.sqrt(-2*Math.log(random())),theta=2*Math.PI*random(),z=r*Math.cos(theta),other=model.correlation*z+Math.sqrt(1-model.correlation**2)*r*Math.sin(theta);observe(model.homeMean+model.homeSigma*z,model.awayMean+model.awaySigma*other,1);}
 }
 return (['home','away'] as const).flatMap((winner,i)=>(['over','under'] as const).map((side,j)=>({winner,side,probability:counters[i*2+j]/weight,winnerProbability:wins[i]/weight,totalProbability:totals[j]/weight})));
}
