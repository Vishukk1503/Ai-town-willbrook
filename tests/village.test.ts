import {villageLayout,flood,inside,advanceVisit,Village} from '../convex/aiTown/villageState';
import {availableActions} from '../convex/aiTown/actionChoice';
import {WorldMap} from '../convex/aiTown/worldMap';
import {blockedWithPositions} from '../convex/aiTown/movement';

test('village plots preserve all previously reachable ground except solid building footprints',()=>{
  const blocked=(p:{x:number;y:number})=>p.x===0||p.y===0||p.x===35||p.y===29;
  const start={x:18,y:15},reserved=[{x:15,y:12,w:6,h:6}];
  const layout=villageLayout(36,30,start,blocked,reserved);
  expect(layout.plots).toHaveLength(3);expect(layout.paths).toHaveLength(3);
  const before=flood(36,30,start,blocked),after=flood(36,30,start,p=>blocked(p)||layout.plots.some(r=>inside(p,r)));
  expect(after.size).toBe(before.size-layout.plots.reduce((n,r)=>n+r.w*r.h,0));
  for(const path of layout.paths){
    expect(path[0]).toEqual(start);
    for(let i=0;i<path.length;i++){
      expect(layout.plots.some(r=>inside(path[i],r))).toBe(false);
      if(i)expect(Math.abs(path[i].x-path[i-1].x)+Math.abs(path[i].y-path[i-1].y)).toBe(1);
    }
  }
});
test('layout refuses a cramped site without partially mutating reserved land',()=>{
  const reserved=[{x:0,y:0,w:8,h:8}],before=JSON.stringify(reserved);
  expect(()=>villageLayout(8,8,{x:1,y:1},()=>false,reserved)).toThrow('No safe connected');
  expect(JSON.stringify(reserved)).toBe(before);
});
function village():Village{return {places:[{id:'tavern',name:'Hearth & Reed',kind:'tavern',footprint:{x:4,y:4,w:5,h:3},entrance:{x:6,y:7},description:'Courtyard'},{id:'home',name:'My cottage',kind:'home',owner:'p:0',footprint:{x:12,y:4,w:3,h:3},entrance:{x:13,y:7},description:'Doorstep'}],paths:[],visits:[{owner:'p:0',placeId:'tavern'}],events:[],nextEvent:0};}
test('a visit requires travel and twelve seconds at the entrance before recording one real event',()=>{
  const v=village();expect(advanceVisit(v,'p:0',{x:1,y:1},1000)?.destination).toEqual({x:6,y:7});
  expect(v.events).toHaveLength(0);advanceVisit(v,'p:0',{x:6,y:7},2000);
  advanceVisit(v,'p:0',{x:6,y:7},13999);expect(v.events).toHaveLength(0);
  expect(advanceVisit(v,'p:0',{x:6,y:7},14000)?.finished).toBe(true);
  expect(v.events).toHaveLength(1);expect(v.visits).toHaveLength(0);
  advanceVisit(v,'p:0',{x:6,y:7},15000);expect(v.events).toHaveLength(1);
});
test('paused wall time cannot instantly complete a visit',()=>{
  const v=village();advanceVisit(v,'p:0',{x:6,y:7},1000,500);
  advanceVisit(v,'p:0',{x:6,y:7},1000000,750);expect(v.events).toHaveLength(0);
});
test('residents may choose their own doorstep and public tavern but not another private home',()=>{
  const w={players:[{id:'p:0',position:{x:1,y:1}},{id:'p:1',position:{x:2,y:2}}],conversations:[],village:village()};
  expect(availableActions(w,'p:0',100000).map(o=>o.id)).toEqual(expect.arrayContaining(['place:tavern','place:home']));
  expect(availableActions(w,'p:1',100000).map(o=>o.id)).not.toContain('place:home');
});
test('new walls survive map serialization and block navigation while the entrance stays open',()=>{
  const layer=Array.from({length:20},()=>Array(20).fill(-1));
  const map=new WorldMap({width:20,height:20,tileSetUrl:'test',tileSetDimX:32,tileSetDimY:32,tileDim:32,bgTiles:[],objectTiles:[layer],animatedSprites:[],villageObstacles:[{x:4,y:4,w:5,h:3}]});
  const restored=new WorldMap(map.serialize());
  expect(blockedWithPositions({x:6,y:5},[],restored)).toBe('village building');
  expect(blockedWithPositions({x:6,y:7},[],restored)).toBeNull();
});
