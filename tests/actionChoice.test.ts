import {livelihood} from '../convex/aiTown/livelihoodState';
import {availableActions,parseAction,fallbackAction,DecisionWorld} from '../convex/aiTown/actionChoice';
import {emptyItems} from '../convex/aiTown/economyState';
import {agentInputs} from '../convex/aiTown/agentInputs';
import {Agent} from '../convex/aiTown/agent';
function world():DecisionWorld{return {
  players:[{id:'p:0',position:{x:20,y:20}},{id:'p:1',position:{x:10,y:10}},{id:'p:2',position:{x:11,y:11}}],conversations:[],
  garden:{owner:'p:1',home:{x:1,y:1},origin:{x:0,y:0},time:0,seeds:1,food:2,nextJob:0,beds:[{id:0,x:2,y:5,state:'empty'}],events:[],nextEvent:0},
  economy:{merchant:'p:2',fisher:'p:0',market:{x:10,y:10},bank:{x:20,y:20},water:{x:22,y:20},bags:[{owner:'p:0',items:{...emptyItems(),rod:1}},{owner:'p:1',items:emptyItems()},{owner:'p:2',items:emptyItems()}],marketStock:{...emptyItems(),seeds:4},population:2,lastRecovery:0,rng:12345,jobs:[],nextFish:0,events:[],nextEvent:0},
};}
test('action menu respects profession, resources, cooldowns and busy targets',()=>{
  const w=world();expect(availableActions(w,'p:0',100000).map(o=>o.id)).toContain('fish');
  expect(availableActions(w,'p:0',100000).map(o=>o.id)).not.toContain('garden');
  expect(availableActions(w,'p:1',100000).map(o=>o.id)).toEqual(expect.arrayContaining(['garden','trade']));
  w.economy!.bags[0].items.rod=0;expect(availableActions(w,'p:0',100000).map(o=>o.id)).not.toContain('fish');
  w.conversations=[{participants:[{playerId:'p:1'},{playerId:'p:2'}]}];
  expect(availableActions(w,'p:0',100000).map(o=>o.id)).not.toContain('talk:p:1');
  expect(availableActions(w,'p:1',100000)).toEqual([]);
  w.conversations=[];expect(availableActions(w,'p:0',100000,95000).some(o=>o.kind==='talk')).toBe(false);
});
test('model output cannot select unavailable actions, forge targets or add execution parameters',()=>{
  const options=availableActions(world(),'p:0',100000);
  expect(parseAction('{"action":"fish","reason":"I want some quiet."}',options).option.kind).toBe('fish');
  for(const text of ['{"action":"build_castle","reason":"why"}','{"action":"talk:p:99","reason":"why"}','{"action":"fish","reason":"why","quantity":999}','```json\n{}\n```'])expect(()=>parseAction(text,options)).toThrow();
});
test('fallback remains within the supplied menu and discourages repeating an activity',()=>{
  const options=availableActions(world(),'p:1',100000,0,0,'Bob');
  expect(fallbackAction(options)?.kind).toBe('garden');
  expect(fallbackAction(options,'garden')?.kind).toBe('trade');
  expect(fallbackAction([])).toBeUndefined();
});
function gameFixture(){
  const w=world(),a=new Agent({id:'a:0' as any,playerId:'p:0' as any,inProgressOperation:{name:'agentChooseAction',operationId:'o:0',started:100000}});
  const g:any={world:{...w,players:new Map(w.players.map(p=>[p.id,{...p,speed:0}])),agents:new Map([['a:0',a]]),serialize:()=>({...w,economy:g.world.economy}),playerConversation:()=>undefined},playerDescriptions:new Map([['p:0',{name:'Lucky'}]]),worldMap:{width:64,height:64}};
  return {g,a};
}
test('accepted fishing choice creates a work job without granting fish or memories',()=>{
  const {g,a}=gameFixture();agentInputs.finishDecision.handler(g,100000,{agentId:'a:0',operationId:'o:0',action:'fish',reason:'I want some quiet.',source:'model'});
  expect(g.world.economy.jobs).toEqual([{owner:'p:0',kind:'fish',requested:0}]);
  expect(g.world.economy.bags[0].items.fish).toBe(0);expect(g.world.economy.events).toHaveLength(0);
  expect(a.inProgressOperation).toBeUndefined();expect(a.decision?.source).toBe('model');
});
test('execution rejects a stale operation and revalidates inventory after the model returns',()=>{
  const {g,a}=gameFixture();
  agentInputs.finishDecision.handler(g,100000,{agentId:'a:0',operationId:'old',action:'fish',reason:'quiet',source:'model'});
  expect(a.inProgressOperation).toBeDefined();expect(g.world.economy.jobs).toHaveLength(0);
  g.world.economy.bags[0].items.rod=0;
  agentInputs.finishDecision.handler(g,100000,{agentId:'a:0',operationId:'o:0',action:'fish',reason:'quiet',source:'model'});
  expect(g.world.economy.jobs).toHaveLength(0);expect(a.decision?.source).toBe('fallback');
  expect(a.decision?.kind).toBe('wander');
});
test('rest survives engine serialization and does not start work or another model call each tick',()=>{
  const {g,a}=gameFixture();g.world.livelihood=livelihood(['p:0'],0);g.world.livelihood.needs[0].energy=45;const serialize=g.world.serialize;g.world.serialize=()=>({...serialize(),livelihood:g.world.livelihood});
  agentInputs.finishDecision.handler(g,100000,{agentId:'a:0',operationId:'o:0',action:'rest',reason:'Enough bustle.',source:'model'});
  const restored=new Agent(a.serialize());restored.tick(g,105000);
  expect(restored.decision?.kind).toBe('rest');expect(restored.inProgressOperation).toBeUndefined();expect(g.world.economy.jobs).toHaveLength(0);
});

test('switching from fishing to rest cancels unfinished work without awarding a catch',()=>{
  const {g,a}=gameFixture();
  g.world.livelihood=livelihood(['p:0'],0);g.world.livelihood.needs[0].energy=45;const serialize=g.world.serialize;g.world.serialize=()=>({...serialize(),livelihood:g.world.livelihood});
  g.world.economy.jobs=[{owner:'p:0',kind:'fish',requested:0,started:0}];
  agentInputs.finishDecision.handler(g,100000,{agentId:'a:0',operationId:'o:0',action:'rest',reason:'My legs need a rest.',source:'model'});
  expect(g.world.economy.jobs).toEqual([]);
  expect(g.world.economy.bags[0].items.fish).toBe(0);
  expect(a.decision?.kind).toBe('rest');
});
test('finishing a background summary cannot clear a newer action operation',()=>{
  const {g,a}=gameFixture();a.memoryOperation={operationId:'summary',started:90000};
  agentInputs.finishRememberConversation.handler(g,100000,{agentId:'a:0',operationId:'summary'});
  expect(a.memoryOperation).toBeUndefined();expect(a.inProgressOperation?.operationId).toBe('o:0');
});
test('a failed dialogue releases the actor without fabricating a message or interrupting a newer operation',()=>{
  const {g,a}=gameFixture();
  agentInputs.failedDialogue.handler(g,100000,{agentId:'a:0',operationId:'old'});
  expect(a.inProgressOperation?.operationId).toBe('o:0');
  a.inProgressOperation!.name='agentGenerateMessage';
  agentInputs.failedDialogue.handler(g,100000,{agentId:'a:0',operationId:'o:0'});
  expect(a.inProgressOperation).toBeUndefined();expect(a.nextDecisionAt).toBe(105000);
  expect(g.world.players.get('p:0').activity.description).toContain('Conversation unavailable');
  expect(g.world.economy.events).toHaveLength(0);
});
