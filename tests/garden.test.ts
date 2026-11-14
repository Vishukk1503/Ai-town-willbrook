import {Garden,tickGarden,workGarden} from '../convex/aiTown/gardenState';
import {Agent} from '../convex/aiTown/agent';
function garden():Garden{return {owner:'bob',home:{x:1,y:1},origin:{x:0,y:0},seeds:1,food:0,time:0,nextJob:0,beds:[{id:0,x:2,y:5,state:'empty'}],events:[],nextEvent:0};}
test('Bob must arrive and work before planting; seeds, growth and harvest are conserved',()=>{
  const g=garden();
  expect(workGarden(g,{x:20,y:20},1000)?.destination).toEqual({x:2,y:5});
  expect(g.seeds).toBe(1);expect(g.events).toHaveLength(0);
  workGarden(g,{x:2,y:5},1000);g.time=4999;workGarden(g,{x:2,y:5},5999);expect(g.beds[0].state).toBe('empty');
  g.time=5000;workGarden(g,{x:2,y:5},6000);expect(g.seeds).toBe(0);expect(g.beds[0].state).toBe('growing');expect(g.events).toHaveLength(1);
  g.time=50000;tickGarden(g,51000);expect(g.beds[0].state).toBe('ready');
  workGarden(g,{x:2,y:5},51000);g.time+=4000;workGarden(g,{x:2,y:5},55000);
  expect(g.food).toBe(2);expect(g.beds[0].state).toBe('empty');expect(g.events).toHaveLength(2);
  g.time+=30000;workGarden(g,{x:2,y:5},85000);expect(g.job).toBeUndefined();expect(g.food).toBe(2);
});
test('resuming after a long pause does not instantly grow a crop',()=>{
  const g=garden();tickGarden(g,1000);tickGarden(g,1016);expect(g.time).toBe(16);
  tickGarden(g,1000000);expect(g.time).toBe(266);
});
test('physical garden work proceeds while a conversation summary is still generating',()=>{
  const g=garden();g.owner='p:2';
  const player={id:'p:2',position:{x:2,y:5},activity:undefined};
  const agent=new Agent({id:'a:3' as any,playerId:'p:2' as any,inProgressOperation:{name:'agentRememberConversation',operationId:'summary',started:1000}});
  agent.decision={kind:'garden',label:'Plant a garden bed',reason:'The bed is ready.',source:'model',chosenAt:1000,until:90000};
  agent.tick({world:{garden:g,players:new Map([['p:2',player]]),playerConversation:()=>undefined}} as any,2000);
  expect(g.job?.kind).toBe('plant');expect(player.activity).toMatchObject({description:'Planting turnips'});
  expect(agent.memoryOperation?.operationId).toBe('summary');expect(agent.inProgressOperation).toBeUndefined();
});
