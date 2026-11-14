import {internalMutation} from './_generated/server';
import {emptyItems} from './aiTown/economyState';
import {WorldMap} from './aiTown/worldMap';
import {blockedWithPositions} from './aiTown/movement';
import {stopEngine,startEngine} from './aiTown/main';
export const build=internalMutation({args:{},handler:async ctx=>{
  const status=await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();if(!status)throw new Error('No town');
  const world=await ctx.db.get(status.worldId);if(!world?.garden)throw new Error('Build the garden first');if(world.economy)return {alreadyBuilt:true};
  const descriptions=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',world._id)).collect();
  const merchant=descriptions.find(p=>p.name==='Stella')?.playerId,fisher=descriptions.find(p=>p.name==='Lucky')?.playerId;
  const map=await ctx.db.query('maps').withIndex('worldId',q=>q.eq('worldId',world._id)).unique();if(!map||!merchant||!fisher)throw new Error('Missing map or residents');
  const m=new WorldMap(map),garden=world.garden,origin={x:garden.home.x+1,y:garden.home.y+3},seen=new Set<string>(),queue=[origin];
  for(let i=0;i<queue.length;i++){const p=queue[i],key=`${p.x},${p.y}`;if(seen.has(key)||blockedWithPositions(p,[],m))continue;seen.add(key);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])queue.push({x:p.x+dx,y:p.y+dy});}
  const sites=[],banks=[];
  for(let x=2;x<m.width-6;x++)for(let y=2;y<m.height-6;y++){
    if(seen.has(`${x},${y}`)&&m.bgTiles[0][x][y]===271){
      for(const [dx,dy] of [[2,0],[-2,0],[0,2],[0,-2]])if([451,452].includes(m.bgTiles[0][x+dx][y+dy]))banks.push({bank:{x,y},water:{x:x+dx,y:y+dy},d:Math.hypot(x-origin.x,y-origin.y)});
    }
    if(x<garden.origin.x+9&&x+5>garden.origin.x-1&&y<garden.origin.y+9&&y+5>garden.origin.y-1)continue;
    let clear=true;for(let dx=0;dx<5&&clear;dx++)for(let dy=0;dy<5;dy++)if(!seen.has(`${x+dx},${y+dy}`)){clear=false;break;}
    if(clear&&!world.players.some(p=>p.position.x>=x&&p.position.x<x+3&&p.position.y>=y&&p.position.y<y+1))sites.push({x,y,d:Math.hypot(x-origin.x,y-origin.y)});
  }
  const market=sites.sort((a,b)=>a.d-b.d)[0],spot=banks.sort((a,b)=>a.d-b.d)[0];if(!market||!spot)throw new Error('No valid market or riverbank site; nothing changed');
  const running=status.status==='running';if(running)await stopEngine(ctx,world._id);
  await ctx.db.patch(world._id,{economy:{merchant,fisher,market:{x:market.x,y:market.y},bank:spot.bank,water:spot.water,
    bags:world.agents.map(a=>({owner:a.playerId,items:{...emptyItems(),rod:a.playerId===fisher?1:0}})),marketStock:{...emptyItems(),seeds:12},population:4,lastRecovery:garden.time,rng:12345,jobs:[],nextFish:garden.time,events:[],nextEvent:0}});
  await ctx.db.patch(map._id,{marketObstacle:{x:market.x,y:market.y,w:3,h:1}});
  if(running)await startEngine(ctx,world._id);
  return {market:{x:market.x,y:market.y},fishing:spot.bank,water:spot.water,stock:'12 seed packets; 4 river fish; Lucky receives 1 rod'};
}});
