import {socialBoundary} from './socialBoundary';
import {Infer,v} from 'convex/values';
import type {SerializedWorldMap} from './worldMap';
type Point={x:number;y:number};
const point=v.object({x:v.number(),y:v.number()});
const sight=v.object({id:v.string(),position:point,at:v.number()});
export const awarenessState=v.object({
  boundaries:v.optional(v.array(socialBoundary)),
  visible:v.array(v.string()),lastSeen:v.array(sight),nextScan:v.number(),nextReaction:v.number(),
  trigger:v.string(),pleasantness:v.number(),stress:v.number(),socialReadiness:v.number(),
  lastClock:v.number(),lastEvent:v.number(),
  lastCompanyClock:v.optional(v.number()),
  branch:v.optional(v.string()),scores:v.optional(v.array(v.object({label:v.string(),score:v.number()}))),
});
export type Awareness=Infer<typeof awarenessState>;
export function initialAwareness(clock=0):Awareness{return {visible:[],lastSeen:[],nextScan:0,nextReaction:0,trigger:'Beginning village life',pleasantness:55,stress:20,socialReadiness:50,lastClock:clock,lastEvent:-1};}
export function opaque(map:Pick<SerializedWorldMap,'width'|'height'|'objectTiles'|'villageObstacles'|'homeObstacle'|'marketObstacle'>,p:Point){
  const x=Math.floor(p.x),y=Math.floor(p.y);
  if(x<0||y<0||x>=map.width||y>=map.height)return true;
  const obstacles=[...(map.villageObstacles??[]),map.homeObstacle,map.marketObstacle];
  return obstacles.some(r=>r&&x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h)||(map.objectTiles??[]).some(layer=>(layer[x]?.[y]??-1)!==-1);
}
export function canSee(map:Parameters<typeof opaque>[0],from:Point,to:Point){
  const a={x:Math.floor(from.x),y:Math.floor(from.y)},b={x:Math.floor(to.x),y:Math.floor(to.y)};
  if(Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))>3)return false;
  // Supercover traversal: corner-touching walls also occlude a diagonal sightline.
  let x=a.x,y=a.y;const dx=b.x-a.x,dy=b.y-a.y,nx=Math.abs(dx),ny=Math.abs(dy),sx=Math.sign(dx),sy=Math.sign(dy);
  let ix=0,iy=0;
  while(ix<nx||iy<ny){
    const comparison=(1+2*ix)*ny-(1+2*iy)*nx;
    if(comparison===0){
      if(opaque(map,{x:x+sx,y})||opaque(map,{x,y:y+sy}))return false;
      x+=sx;y+=sy;ix++;iy++;
    }else if(comparison<0){x+=sx;ix++;}else{y+=sy;iy++;}
    if(opaque(map,{x,y}))return false;
  }
  return true;
}
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
export function updateMood(a:Awareness,clock:number,needs:{hunger:number;energy:number;restedness?:number}|undefined,events:{id:number;kind:string;witnesses:string[]}[],owner:string,sociability=50,socializing=false){
  const dt=Math.max(0,Math.min(1000,clock-a.lastClock));a.lastClock=clock;
  const discomfort=needs?Math.max(0,needs.hunger-65)/5+Math.max(0,30-needs.energy)/3+Math.max(0,30-(needs.restedness??65))/3:0;
  const approach=(n:number,target:number)=>n+(target-n)*dt/600000;
  a.pleasantness=clamp(approach(a.pleasantness,55-discomfort));
  a.stress=clamp(approach(a.stress,20+discomfort));
  a.lastCompanyClock??=clock;if(socializing)a.lastCompanyClock=clock;
  const baseline=25+sociability*.5;
  a.socialReadiness=clamp(socializing?a.socialReadiness-dt*2/60000:approach(a.socialReadiness,baseline+15));
  const fresh=events.filter(e=>e.id>a.lastEvent&&e.witnesses.includes(owner));
  // At most one reward of each kind per update; ordinary repeated chatter gives no reward.
  for(const kind of new Set(fresh.map(e=>e.kind))){
    if(['eat','barter','gift','cooking_agreement','activity_completed'].includes(kind)){a.pleasantness=clamp(a.pleasantness+2);a.stress=clamp(a.stress-2);}
    if(kind==='expired')a.stress=clamp(a.stress+2);
  }
  a.lastEvent=Math.max(a.lastEvent,...events.map(e=>e.id));
}
