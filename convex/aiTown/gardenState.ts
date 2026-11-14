import {v,Infer} from 'convex/values';
export const gardenState=v.object({
  owner:v.string(),home:v.object({x:v.number(),y:v.number()}),origin:v.object({x:v.number(),y:v.number()}),
  seeds:v.number(),food:v.number(),time:v.number(),lastTick:v.optional(v.number()),nextJob:v.number(),
  renewableSeeds:v.optional(v.boolean()),
  beds:v.array(v.object({id:v.number(),x:v.number(),y:v.number(),state:v.union(v.literal('empty'),v.literal('growing'),v.literal('ready')),readyAt:v.optional(v.number())})),
  job:v.optional(v.object({bed:v.number(),kind:v.union(v.literal('plant'),v.literal('harvest')),started:v.optional(v.number()),requested:v.optional(v.number())})),
  events:v.array(v.object({id:v.number(),text:v.string(),at:v.number(),kind:v.string()})),nextEvent:v.number(),
});
export type Garden=Infer<typeof gardenState>;
export function tickGarden(g:Garden,now:number){
  g.time+=g.lastTick===undefined?0:Math.max(0,Math.min(250,now-g.lastTick));g.lastTick=now;
  for(const b of g.beds)if(b.state==='growing'&&b.readyAt!==undefined&&g.time>=b.readyAt)b.state='ready';
}
export function workGarden(g:Garden,position:{x:number;y:number},now:number){
  if(!g.job&&g.time>=g.nextJob){
    const bed=g.beds.find(b=>b.state==='ready')??(g.seeds>0?g.beds.find(b=>b.state==='empty'):undefined);
    if(bed)g.job={bed:bed.id,kind:bed.state==='ready'?'harvest':'plant',requested:g.time};
  }
  const job=g.job;if(!job)return null;
  if(job.requested===undefined)job.requested=g.time;
  if(g.time-job.requested>120000){delete g.job;g.nextJob=g.time+10000;return null;}
  const bed=g.beds.find(b=>b.id===job.bed)!;
  if(Math.hypot(position.x-bed.x,position.y-bed.y)>.55)return {destination:{x:bed.x,y:bed.y},label:'Walking to the garden'};
  if(job.started===undefined)job.started=g.time;
  const duration=job.kind==='plant'?5000:4000;
  if(g.time-job.started<duration)return {label:job.kind==='plant'?'Planting turnips':'Harvesting turnips'};
  if(job.kind==='plant'&&bed.state==='empty'&&g.seeds>0){g.seeds--;bed.state='growing';bed.readyAt=g.time+45000;}
  else if(job.kind==='harvest'&&bed.state==='ready'){g.food+=2;if(g.renewableSeeds)g.seeds++;bed.state='empty';delete bed.readyAt;}
  else {delete g.job;return null;}
  g.events.push({id:g.nextEvent++,text:job.kind==='plant'?'Bob planted turnip seeds in the garden.':'Bob harvested two turnips and stored them at home.',at:now,kind:job.kind});
  g.events=g.events.slice(-20);g.nextJob=g.time+12000;delete g.job;
  return {label:'Finished garden work'};
}
