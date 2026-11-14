import {WORLD_TIME_SCALE_LABEL,worldTime} from '../../data/worldTime';
export default function WorldClock({elapsedMs,running}:{elapsedMs:number;running:boolean}){
  const t=worldTime(elapsedMs);
  return <section className="village-clock" aria-label="World clock" title="1 real minute = 1 village hour. Time pauses with the town."><span className="village-clock-icon" aria-hidden="true">{t.phase==='Night'?'☾':t.phase==='Dawn'||t.phase==='Dusk'?'◐':'☀'}</span><div><strong>Day {t.day} <time>{t.time}</time></strong><small>{t.phase} · {running?WORLD_TIME_SCALE_LABEL:'Paused'}</small></div></section>;
}
