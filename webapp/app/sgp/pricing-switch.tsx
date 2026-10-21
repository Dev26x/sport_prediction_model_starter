'use client';
export default function PricingSwitch({value,onChange}:{value:'fanduel'|'research';onChange:(value:'fanduel'|'research')=>void}){
 return <div className="fd-pricing-switch" role="group" aria-label="SGP pricing source"><button className={value==='fanduel'?'selected':''} aria-pressed={value==='fanduel'} onClick={()=>onChange('fanduel')}>FanDuel Ontario · copied lines</button><button className={value==='research'?'selected':''} aria-pressed={value==='research'} onClick={()=>onChange('research')}>Model research · unquoted</button></div>;
}
