import {internalMutation,internalQuery} from './_generated/server';
import {WorldMap} from './aiTown/worldMap';
import {blockedWithPositions} from './aiTown/movement';
import {stopEngine,startEngine} from './aiTown/main';

export const survey=internalQuery({args:{},handler:async ctx=>{
  const status=await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();
  if(!status)throw new Error('No world');
  const world=await ctx.db.get(status.worldId),map=await ctx.db.query('maps').withIndex('worldId',q=>q.eq('worldId',status.worldId)).unique();
  const people=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',status.worldId)).collect();
  if(!world||!map)throw new Error('Missing world');
  const bob=world.players.find(p=>p.id===people.find(d=>d.name==='Bob')?.playerId);if(!bob)throw new Error('Bob not found');
  const m=new WorldMap(map),reachable=new Set<string>(),queue=[{x:Math.round(bob.position.x),y:Math.round(bob.position.y)}];
  for(let i=0;i<queue.length;i++){const p=queue[i],key=`${p.x},${p.y}`;if(reachable.has(key)||blockedWithPositions(p,[],m))continue;reachable.add(key);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])queue.push({x:p.x+dx,y:p.y+dy});}
  const plots=[];
  for(let x=2;x<m.width-9;x++)for(let y=2;y<m.height-9;y++){
    let clear=true;for(let dx=0;dx<8&&clear;dx++)for(let dy=0;dy<8;dy++)if(!reachable.has(`${x+dx},${y+dy}`)){clear=false;break;}
    if(clear&&!world.players.some(p=>p.position.x>=x+1&&p.position.x<x+4&&p.position.y>=y&&p.position.y<y+3))plots.push({x,y,distance:Math.hypot(bob.position.x-(x+3),bob.position.y-(y+5))});
  }
  return {worldId:world._id,owner:bob.id,width:m.width,height:m.height,reachable:reachable.size,candidates:plots.sort((a,b)=>a.distance-b.distance).slice(0,5),existing:!!world.garden};
}});

export const build=internalMutation({args:{},handler:async ctx=>{
  const status=await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();if(!status)throw new Error('No world');
  const world=await ctx.db.get(status.worldId);if(!world)throw new Error('No world');if(world.garden)return {alreadyBuilt:true};
  const map=await ctx.db.query('maps').withIndex('worldId',q=>q.eq('worldId',status.worldId)).unique();if(!map)throw new Error('No map');
  const people=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',status.worldId)).collect();
  const bob=world.players.find(p=>p.id===people.find(d=>d.name==='Bob')?.playerId);if(!bob)throw new Error('No Bob');
  const m=new WorldMap(map),seen=new Set<string>(),queue=[{x:Math.round(bob.position.x),y:Math.round(bob.position.y)}];
  for(let i=0;i<queue.length;i++){const p=queue[i],key=`${p.x},${p.y}`;if(seen.has(key)||blockedWithPositions(p,[],m))continue;seen.add(key);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])queue.push({x:p.x+dx,y:p.y+dy});}
  const candidates=[];
  for(let x=2;x<m.width-9;x++)for(let y=2;y<m.height-9;y++){
    let clear=true;for(let dx=0;dx<8&&clear;dx++)for(let dy=0;dy<8;dy++)if(!seen.has(`${x+dx},${y+dy}`)){clear=false;break;}
    if(clear&&!world.players.some(p=>p.position.x>=x+1&&p.position.x<x+4&&p.position.y>=y&&p.position.y<y+3))candidates.push({x,y,d:Math.hypot(bob.position.x-(x+3),bob.position.y-(y+5))});
  }
  const site=candidates.sort((a,b)=>a.d-b.d)[0];if(!site)throw new Error('No clear reachable plot; no map changes made.');
  const wasRunning=status.status==='running';if(wasRunning)await stopEngine(ctx,world._id);
  const home={x:site.x+1,y:site.y};
  await ctx.db.patch(world._id,{garden:{owner:bob.id,home,origin:{x:site.x,y:site.y},seeds:6,food:0,time:0,nextJob:0,beds:[0,1,2].map(i=>({id:i,x:site.x+1+i*2,y:site.y+5,state:'empty' as const})),events:[],nextEvent:0}});
  await ctx.db.patch(map._id,{homeObstacle:{...home,w:3,h:3}});
  if(wasRunning)await startEngine(ctx,world._id);
  return {site,home,seeds:6,beds:3};
}});
