export const WORLD_MINUTE_MS=1000;
export const WORLD_HOUR_MS=60*WORLD_MINUTE_MS;
export const WORLD_DAY_MS=24*WORLD_HOUR_MS;
export const WORLD_TIME_SCALE_LABEL='1 min = 1 hour';
export function worldTime(elapsedMs=0){
  const total=8*60+Math.floor(Math.max(0,elapsedMs)/WORLD_MINUTE_MS);
  const day=Math.floor(total/1440)+1,hour=Math.floor(total%1440/60),minute=total%60;
  const phase=hour<5?'Night':hour<7?'Dawn':hour<18?'Day':hour<20?'Dusk':'Night';
  return {day,hour,minute,phase,time:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`};
}
