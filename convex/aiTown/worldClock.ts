import {Infer,v} from 'convex/values';
export const worldClock=v.object({elapsedMs:v.number(),lastTick:v.optional(v.number())});
export type WorldClock=Infer<typeof worldClock>;
export function advanceWorldClock(clock:WorldClock,now:number){
  clock.elapsedMs+=clock.lastTick===undefined?0:Math.max(0,Math.min(250,now-clock.lastTick));
  clock.lastTick=now;
}
