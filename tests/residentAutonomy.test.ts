import {canSee,initialAwareness,updateMood} from '../convex/aiTown/awareness';
import {advanceNeeds,livelihood} from '../convex/aiTown/livelihoodState';
import {initialLearning,validatePlan,selectPlan,confirmStep} from '../convex/aiTown/learnedPlans';
import {availableActions} from '../convex/aiTown/actionChoice';
import {Agent} from '../convex/aiTown/agent';
import {parseTownSpeech,repeatsDialogue,mutualClosure} from '../data/dialogue';
import {behaviorBranch} from '../convex/aiTown/behaviorTree';
import {Game} from '../convex/aiTown/game';
import {agentInputs} from '../convex/aiTown/agentInputs';

const map=()=>({width:20,height:20,objectTiles:[],villageObstacles:[] as {x:number;y:number;w:number;h:number}[]});
test('vision covers three tiles in every direction, but not four',()=>{
  for(const dx of [-3,0,3])for(const dy of [-3,0,3])expect(canSee(map(),{x:8,y:8},{x:8+dx,y:8+dy})).toBe(true);
  expect(canSee(map(),{x:8,y:8},{x:12,y:8})).toBe(false);
});
test('buildings, map objects and diagonal wall corners block sight',()=>{
  const m=map();m.villageObstacles=[{x:9,y:8,w:1,h:1}];
  expect(canSee(m,{x:8,y:8},{x:11,y:8})).toBe(false);
  expect(canSee(m,{x:8,y:8},{x:9,y:9})).toBe(false);
  const tiles=Array.from({length:20},()=>Array(20).fill(-1));tiles[9][8]=1;
  expect(canSee({...map(),objectTiles:[tiles]},{x:8,y:8},{x:10,y:8})).toBe(false);
});
test('a work-heavy eight-hour shift costs 64 energy, and a one-hour break restores 20',()=>{
 const l=livelihood(['bob'],0);l.needs[0].energy=100;l.needs[0].hunger=0;
 for(let i=1;i<=480;i++)advanceNeeds(l,i*1000,()=> 'work');
 expect(l.needs[0].energy).toBeCloseTo(36);expect(l.needs[0].hunger).toBeCloseTo(48);
 for(let i=481;i<=540;i++)advanceNeeds(l,i*1000,()=> 'rest');
 expect(l.needs[0].energy).toBeCloseTo(56);
 advanceNeeds(l,l.clock,()=> 'work');expect(l.needs[0].energy).toBeCloseTo(56);
});

test('world pauses do not drain needs or accumulate unlimited offline catch-up',()=>{
  const l=livelihood(['bob'],0);advanceNeeds(l,86400000,()=> 'work');
  expect(l.needs[0].energy).toBeGreaterThan(79);expect(l.needs[0].hunger).toBeLessThan(31);
});
test('unseen residents can be sought at a remembered position but not invited remotely',()=>{
  const awareness=initialAwareness();awareness.lastSeen=[{id:'lucky',position:{x:2,y:2},at:1}];
  const w={players:[{id:'bob',position:{x:0,y:0}},{id:'lucky',position:{x:12,y:12}}],conversations:[],awareness};
  const options=availableActions(w,'bob',100000);
  expect(options.find(o=>o.id==='visit:lucky')?.destination).toEqual({x:2,y:2});
  expect(options.some(o=>o.id==='talk:lucky')).toBe(false);
  awareness.visible=['lucky'];expect(availableActions(w,'bob',100000).some(o=>o.id==='talk:lucky')).toBe(true);
});
test('encounters trigger one decision while walking, preserve intent, and survive serialization',()=>{
  const a=new Agent({id:'a:0' as any,playerId:'p:0' as any,decision:{kind:'walk',label:'Find fish',reason:'Look by the river',source:'model',chosenAt:1,until:200000}});
  const player={id:'p:0',position:{x:8,y:8},pathfinding:{destination:{x:15,y:8}}};
  let operations=0;
  const game:any={world:{players:new Map<string,any>([['p:0',player],['p:1',{id:'p:1',position:{x:10,y:8}}]]),agents:new Map(),playerConversation:()=>undefined},worldMap:map(),playerDescriptions:new Map([['p:1',{name:'Lucky'}]]),allocId:()=>`o:${operations++}`,scheduleOperation:()=>{}};
  a.tick(game,100000);
  expect(a.awareness?.visible).toEqual(['p:1']);expect(a.suspendedDecision?.reason).toBe('Look by the river');expect(operations).toBe(1);
  a.tick(game,100600);expect(operations).toBe(1);expect(player.pathfinding).toBeDefined();
  const restored=new Agent(a.serialize());expect(restored.awareness?.lastSeen[0].id).toBe('p:1');
});
test('only verified ordered steps teach a routine; duplicate evidence cannot advance it twice',()=>{
  const l=initialLearning(),p=validatePlan({label:'River then garden',steps:['walk:river','walk:garden']},'walk:river',['walk:river'])!;
  selectPlan(l,'walk:river',p);expect(l.routines).toHaveLength(0);
  confirmStep(l,'walk:garden','wrong-order');expect(l.active?.index).toBe(0);
  confirmStep(l,'walk:river','arrival:1');confirmStep(l,'walk:river','arrival:1');expect(l.active?.index).toBe(1);
  selectPlan(l,'walk:garden');confirmStep(l,'walk:garden','arrival:2');expect(l.routines[0].successes).toBe(1);expect(l.active).toBeUndefined();
  expect(()=>validatePlan({label:'Forge',steps:['walk:river','create_gold']},'walk:river',['walk:river'])).toThrow();
  expect(()=>validatePlan({label:'Unverified agreement',steps:['commission:fish','rest']},'commission:fish',['commission:fish','rest'])).toThrow();
});
test('mood is bounded and verified outcomes are not rewarded twice',()=>{
  const a=initialAwareness();const events=[{id:1,kind:'eat',witnesses:['bob']}];
  updateMood(a,0,undefined,events,'bob');expect(a.pleasantness).toBe(57);
  updateMood(a,0,undefined,events,'bob');expect(a.pleasantness).toBe(57);
  for(let i=1;i<=600;i++)updateMood(a,i*1000,{hunger:95,energy:5},events,'bob');
  expect(a.stress).toBeGreaterThan(20);expect(a.pleasantness).toBeLessThan(57);
});
test('natural closure marker is removed from speech and wording loops are caught',()=>{
  expect(parseTownSpeech('I should be off. See you by the garden. [END]')).toEqual({text:'I should be off. See you by the garden.',end:true});
  expect(repeatsDialogue('Stay as long as you like beside the warm hearth.', ['Stay as long as you like beside the warm hearth.'])).toBe(true);
  expect(repeatsDialogue('Yes.', ['Yes.'])).toBe(false);
  expect(()=>parseTownSpeech('[END]')).toThrow();
  expect(mutualClosure('See you tomorrow.','I should go.')).toBe(true);
  expect(mutualClosure('See you tomorrow?','I should go.')).toBe(false);
});

test('behaviour tree handles urgent needs before agreements, then conversation and commitments',()=>{
  const s={urgent:true,agreement:true,conversation:true,committed:true};
  expect(behaviorBranch(s)).toBe('Protect urgent physical needs');
  expect(behaviorBranch({...s,urgent:false})).toBe('Fulfil an accepted agreement');
  expect(behaviorBranch({...s,urgent:false,agreement:false})).toBe('Respond to the current encounter');
});

test('engine executes a seek intention, walks into sight, and starts a consented encounter',()=>{
  const game=new Game({} as any,'world' as any,{
    world:{nextId:100,players:[
      {id:'p:0',position:{x:1,y:3},facing:{dx:1,dy:0},speed:0,lastInput:100000},
      {id:'p:1',position:{x:10,y:3},facing:{dx:-1,dy:0},speed:0,lastInput:100000},
    ],agents:[{id:'a:0',playerId:'p:0',inProgressOperation:{name:'agentChooseAction',operationId:'choose:1',started:100000}}],conversations:[],
    village:{places:[{id:'lucky-home',name:'Lucky’s home',kind:'home',owner:'p:1',entrance:{x:10,y:3},footprint:{x:10,y:5,w:2,h:2},description:'A familiar home'}],paths:[],visits:[],events:[],nextEvent:0}},
    worldMap:{...map(),tileSetUrl:'',tileSetDimX:1,tileSetDimY:1,tileDim:16,bgTiles:[],animatedSprites:[]},
    playerDescriptions:[{playerId:'p:0',name:'Bob',description:'Gardener',character:'f1'},{playerId:'p:1',name:'Lucky',description:'Fisher',character:'f2'}],agentDescriptions:[],
  } as any);
  agentInputs.finishDecision.handler(game,100000,{agentId:'a:0',operationId:'choose:1',action:'visit:p:1',reason:'Ask Lucky for fish',source:'model'});
  const bob=game.world.players.get('p:0' as any)!,a=game.world.agents.get('a:0' as any)!;
  expect(bob.pathfinding?.destination).toEqual({x:10,y:3});
  let now=100000;
  for(;now<112000;now+=16){game.numPathfinds=0;game.tick(now);if(a.awareness?.visible.includes('p:1')&&a.inProgressOperation)break;}
  expect(bob.position.x).toBeGreaterThan(1);expect(a.awareness?.visible).toContain('p:1');
  expect(a.decision?.reason).toBe('Ask Lucky for fish');
  expect(a.inProgressOperation?.name).toBe('agentChooseAction');
  agentInputs.finishDecision.handler(game,now,{agentId:'a:0',operationId:a.inProgressOperation!.operationId,action:'casual:p:1',reason:'Ask about today’s catch',source:'model'});
  const conversation=[...game.world.conversations.values()][0];
  expect(conversation).toBeDefined();expect(conversation.participants.get('p:1' as any)?.status.kind).toBe('invited');
  conversation.acceptInvite(game,game.world.players.get('p:1' as any)!);
  for(let i=0;i<400;i++){game.numPathfinds=0;game.tick(now+=16);if(conversation.participants.get('p:0' as any)?.status.kind==='participating')break;}
  expect(conversation.participants.get('p:0' as any)?.status.kind).toBe('participating');
});
