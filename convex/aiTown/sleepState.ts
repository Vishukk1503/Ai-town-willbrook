import {restedness} from '../../data/restedness';
import {Infer,v} from 'convex/values';
import type {Game} from './game';
import {movePlayer,stopPlayer} from './movement';
import {WORLD_HOUR_MS,worldTime} from '../../data/worldTime';
export const REST_MAX_MS=WORLD_HOUR_MS;
export const REST_RECOVERED=70;
export const sleepState=v.object({phase:v.union(v.literal('going_home'),v.literal('asleep')),home:v.object({x:v.number(),y:v.number()}),requested:v.number(),started:v.optional(v.number()),wakeAt:v.optional(v.number()),mode:v.optional(v.union(v.literal('night'),v.literal('nap'),v.literal('recovery'))),minimumHours:v.optional(v.number()),plannedHours:v.optional(v.number())});
export type SleepState=Infer<typeof sleepState>;
export const canRest=(energy:number|undefined)=>energy!==undefined&&energy<60;
export function sleepWork(game:Game,owner:string,state:SleepState,now:number){
 const p=[...game.world.players.values()].find(p=>p.id===owner);if(!p)return false;
 const clock=game.world.clock?.elapsedMs??game.world.livelihood?.clock??0;
 if(state.phase==='going_home'){
  // An unreachable/blocked home must not trap someone in an endless journey.
  if(clock-state.requested>=2*WORLD_HOUR_MS)return false;
  if(Math.hypot(p.position.x-state.home.x,p.position.y-state.home.y)>.65){if(!p.pathfinding)movePlayer(game,now,p,state.home);p.activity={description:'Going home to sleep',until:now+1000};return true;}
  stopPlayer(p);state.phase='asleep';state.started=clock;
  const hour=worldTime(clock).hour,n=game.world.livelihood?.needs.find(n=>n.owner===owner),night=hour>=20||hour<6;
  state.mode=night?'night':restedness(n)<15?'recovery':'nap';state.plannedHours=state.mode==='nap'?4:8;state.minimumHours=night?6:state.mode==='recovery'?4:2;
  state.wakeAt=clock+state.plannedHours*WORLD_HOUR_MS;
 }
 const n=game.world.livelihood?.needs.find(n=>n.owner===owner),energy=n?.energy??0;
 if(clock>=(state.wakeAt??clock)||(clock-(state.started??clock)>=(state.minimumHours??6)*WORLD_HOUR_MS&&energy>=85&&restedness(n)>=90))return false;
 stopPlayer(p);p.activity={description:'Sleeping at home',emoji:'💤',until:now+1000};return true;
}
