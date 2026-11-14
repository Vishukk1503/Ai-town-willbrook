import {Game} from '../convex/aiTown/game';
import {livelihood} from '../convex/aiTown/livelihoodState';
import {emptyItems} from '../convex/aiTown/economyState';
import {WORLD_HOUR_MS} from '../data/worldTime';
const owners=['p:0','p:1','p:2'];
export function behaviorFixture(hour=20){
 const life=livelihood(owners,0);for(const n of life.needs){n.energy=40;n.hunger=20;n.restedness=65;}
 const game=new Game({} as any,'world' as any,{
  world:{nextId:100,clock:{elapsedMs:(hour-8)*WORLD_HOUR_MS},players:owners.map((id,i)=>({id,position:{x:2+i*5,y:3},facing:{dx:1,dy:0},speed:0,lastInput:100000})),agents:owners.map((playerId,i)=>({id:'a:'+i,playerId})),conversations:[],livelihood:life,
   garden:{owner:'p:0',home:{x:2,y:5},origin:{x:0,y:0},time:0,seeds:0,food:0,nextJob:0,beds:[],events:[],nextEvent:0},
   economy:{merchant:'p:2',fisher:'p:1',market:{x:10,y:10},bank:{x:15,y:3},water:{x:16,y:3},bags:owners.map(owner=>({owner,items:{...emptyItems(),meals:4}})),marketStock:emptyItems(),population:3,lastRecovery:0,rng:12345,jobs:[],nextFish:0,events:[],nextEvent:0},
   village:{places:owners.map((owner,i)=>({id:'home-'+i,name:'Home '+i,kind:'home',owner,entrance:{x:2+i*5,y:6},footprint:{x:2+i*5,y:7,w:2,h:2},description:'A home'})),paths:[],visits:[],events:[],nextEvent:0}},
  worldMap:{width:20,height:20,objectTiles:[],bgTiles:[],tileSetUrl:'',tileSetDimX:1,tileSetDimY:1,tileDim:16,animatedSprites:[]},
  playerDescriptions:owners.map((playerId,i)=>({playerId,name:['Bob','Lucky','Stella'][i],description:'Resident',character:'f1'})),agentDescriptions:[],
 } as any);
 return game;
}