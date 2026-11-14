import {Infer,v} from 'convex/values';
const point=v.object({x:v.number(),y:v.number()});
export const buildingRect=v.object({x:v.number(),y:v.number(),w:v.number(),h:v.number()});
export type Rect=Infer<typeof buildingRect>;
export const villagePlace=v.object({id:v.string(),name:v.string(),kind:v.union(v.literal('home'),v.literal('tavern')),owner:v.optional(v.string()),footprint:buildingRect,entrance:point,description:v.string()});
export const villageState=v.object({places:v.array(villagePlace),paths:v.array(v.array(point)),visits:v.array(v.object({owner:v.string(),placeId:v.string(),arrived:v.optional(v.number())})),events:v.array(v.object({id:v.number(),at:v.number(),text:v.string(),owner:v.string()})),nextEvent:v.number()});
export type Village=Infer<typeof villageState>;
export type Place=Infer<typeof villagePlace>;
export type Point={x:number;y:number};
export const inside=(p:Point,r:Rect)=>p.x>=r.x&&p.x<r.x+r.w&&p.y>=r.y&&p.y<r.y+r.h;

export function flood(width:number,height:number,start:Point,blocked:(p:Point)=>boolean){
  const seen=new Map<string,Point|null>(),queue=[start];
  const key=(p:Point)=>`${p.x},${p.y}`;
  if(blocked(start))return seen;
  seen.set(key(start),null);
  for(let i=0;i<queue.length;i++){
    const p=queue[i];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const n={x:p.x+dx,y:p.y+dy};
      if(n.x<0||n.y<0||n.x>=width||n.y>=height||seen.has(key(n))||blocked(n))continue;
      seen.set(key(n),p);queue.push(n);
    }
  }
  return seen;
}
export function villageLayout(width:number,height:number,start:Point,blocked:(p:Point)=>boolean,reserved:Rect[]){
  const initial=flood(width,height,start,blocked),plots:Rect[]=[],paths:Point[][]=[];
  if(!initial.size)throw new Error('Village anchor is not reachable.');
  for(const size of [{w:5,h:3},{w:3,h:3},{w:3,h:3}]){
    const candidates:Rect[]=[];
    for(let x=2;x<width-size.w-2;x++)for(let y=2;y<height-size.h-3;y++){
      const r={x,y,...size};let clear=true;
      for(let dx=-1;dx<=r.w&&clear;dx++)for(let dy=-1;dy<=r.h+1;dy++){
        const p={x:x+dx,y:y+dy};
        if(!initial.has(`${p.x},${p.y}`)||reserved.concat(plots.map(b=>({x:b.x-1,y:b.y-1,w:b.w+2,h:b.h+3}))).some(b=>inside(p,b))){clear=false;break;}
      }
      if(clear)candidates.push(r);
    }
    candidates.sort((a,b)=>Math.hypot(a.x+a.w/2-start.x,a.y+a.h-start.y)-Math.hypot(b.x+b.w/2-start.x,b.y+b.h-start.y));
    let chosen=false;
    for(const r of candidates){
      const all=[...plots,r],closed=(p:Point)=>blocked(p)||all.some(b=>inside(p,b));
      const reachable=flood(width,height,start,closed);
      const removed=all.reduce((n,b)=>n+b.w*b.h,0);
      if(reachable.size!==initial.size-removed)continue; // Never cut off existing walkable ground.
      const entrance={x:r.x+Math.floor(r.w/2),y:r.y+r.h};
      const route:Point[]=[];let p:Point|null=entrance;
      while(p){route.push(p);p=reachable.get(`${p.x},${p.y}`)??null;}
      if(!route.length||route[route.length-1].x!==start.x||route[route.length-1].y!==start.y)continue;
      plots.push(r);paths.push(route.reverse());chosen=true;break;
    }
    if(!chosen)throw new Error('No safe connected village plot; no changes applied.');
  }
  // Recompute every path with all three buildings present.
  const final=flood(width,height,start,p=>blocked(p)||plots.some(r=>inside(p,r)));
  return {plots,paths:plots.map(r=>{const route:Point[]=[];let p:Point|null={x:r.x+Math.floor(r.w/2),y:r.y+r.h};while(p){route.push(p);p=final.get(`${p.x},${p.y}`)??null;}return route.reverse();})};
}

export function advanceVisit(village:Village,owner:string,position:Point,now:number,clock=now){
  const visit=village.visits.find(v=>v.owner===owner),place=village.places.find(p=>p.id===visit?.placeId);
  if(!visit||!place)return null;
  if(Math.hypot(position.x-place.entrance.x,position.y-place.entrance.y)>.65)return {destination:place.entrance,label:`Walking to ${place.name}`};
  if(visit.arrived===undefined)visit.arrived=clock;
  if(clock-visit.arrived<12000)return {label:place.kind==='tavern'?'Taking a break in the tavern courtyard':`Spending time outside ${place.name}`};
  village.visits=village.visits.filter(v=>v!==visit);
  village.events.push({id:village.nextEvent++,at:now,owner,text:`Visited ${place.name} and spent a quiet moment ${place.kind==='tavern'?'in its courtyard':'by the doorstep'}.`});
  village.events=village.events.slice(-30);
  return {label:'Finished visiting',finished:true};
}
