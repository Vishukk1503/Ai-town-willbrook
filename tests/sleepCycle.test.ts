import {initialAwareness} from '../convex/aiTown/awareness';
import {eat} from '../convex/aiTown/livelihoodState';
import {advanceNeeds} from '../convex/aiTown/livelihoodState';
import {movePlayer} from '../convex/aiTown/movement';
import {Game} from '../convex/aiTown/game';
import {Agent} from '../convex/aiTown/agent';
import {Conversation} from '../convex/aiTown/conversation';
import {agentInputs} from '../convex/aiTown/agentInputs';
import {availableActions} from '../convex/aiTown/actionChoice';
import {livelihood} from '../convex/aiTown/livelihoodState';
import {emptyItems} from '../convex/aiTown/economyState';
import {resumeState} from '../convex/aiTown/resumeState';
import {advanceWorldClock} from '../convex/aiTown/worldClock';
import {WORLD_DAY_MS,WORLD_HOUR_MS,worldTime} from '../data/worldTime';
import {residentActivity} from '../src/components/residentActivity';
import {selectPlan,confirmStep} from '../convex/aiTown/learnedPlans';
import {parseAction} from '../convex/aiTown/actionChoice';
const owners=['p:0','p:1','p:2'];
test('choosing sleep preserves unfinished routine progress without teaching failure',()=>{
 const g=fixture(),a=[...g.world.agents.values()][0];
 a.learning={active:{label:'River then garden',steps:['walk:river','walk:garden'],index:1},routines:[{label:'River then garden',steps:['walk:river','walk:garden'],successes:1,failures:0}],evidence:['arrival:first']};
 choose(g,'sleep',100000);
 expect(a.learning.active?.index).toBe(1);
 expect(a.learning.routines[0].failures).toBe(0);
 expect(a.learning.active?.state).toBe('suspended');
 expect(new Agent(a.serialize()).learning).toEqual(a.learning);
});
function pendingPlan(g:Game){
 const a=[...g.world.agents.values()][0];
 a.learning={active:{label:'River then garden',steps:['walk:river','walk:garden'],index:1},routines:[],evidence:['arrival:first']};return a;
}
test('recovery preserves a plan through wake and revalidates its next chosen action',()=>{
 const g=fixture(),a=pendingPlan(g);choose(g,'sleep',100000);
 const clock=g.world.clock!.elapsedMs;
 a.sleep={phase:'asleep',home:{x:2,y:6},requested:clock,started:clock,wakeAt:clock+8*WORLD_HOUR_MS};
 g.world.clock!.elapsedMs+=8*WORLD_HOUR_MS;
 g.world.livelihood!.needs[0].energy=100;g.world.livelihood!.needs[0].restedness=100;
 a.tick(g,100001);
 expect(a.sleep).toBeUndefined();expect(a.learning?.active?.index).toBe(1);
 expect(a.learning?.active?.state).toBe('suspended');
 choose(g,'walk:garden',100010);
 expect(a.learning?.active?.state).toBe('active');expect(a.decision?.actionId).toBe('walk:garden');
 expect(g.decisionEvents?.some(e=>e.phase==='plan_state'&&e.summary.startsWith('Resumed'))).toBe(true);
});
test('rest and engine-enforced exhaustion retain a plan without advancing it',()=>{
 const g=fixture(),a=pendingPlan(g);choose(g,'rest',100000);
 expect(a.learning?.active?.state).toBe('suspended');
 g.world.livelihood!.needs[0].energy=70;a.tick(g,100001);
 expect(a.learning?.active?.index).toBe(1);
 const h=fixture(),b=pendingPlan(h);h.world.livelihood!.needs[0].energy=5;b.tick(h,100000);
 expect(b.learning?.active?.state).toBe('suspended');expect(b.learning?.active?.index).toBe(1);
});
test('unavailable next step stays pending and stale replies cannot abandon it',()=>{
 const g=fixture(),a=pendingPlan(g);a.learning!.active!.steps[1]='fish';
 choose(g,'sleep',100000);choose(g,'fish',100010); // Bob cannot fish: existing fallback is revalidated.
 expect(a.decision?.actionId).not.toBe('fish');expect(a.learning?.active?.index).toBe(1);
 const before=JSON.stringify(a.learning);
 agentInputs.finishDecision.handler(g,100011,{agentId:a.id,operationId:'outdated',action:'wander',reason:'Drop plan',source:'model',abandonPlan:true});
 expect(JSON.stringify(a.learning)).toBe(before);
});
test('explicit abandonment is recorded once and survives reload without revival',()=>{
 const g=fixture(),a=pendingPlan(g);a.inProgressOperation={name:'agentChooseAction',operationId:'abandon',started:100000};
 const args={agentId:a.id,operationId:'abandon',action:'wander',reason:'I no longer want this route',source:'model' as const,abandonPlan:true};
 agentInputs.finishDecision.handler(g,100000,args);agentInputs.finishDecision.handler(g,100001,args);
 expect(a.learning?.active).toBeUndefined();expect(new Agent(a.serialize()).learning?.active).toBeUndefined();
 expect(g.decisionEvents?.filter(e=>e.phase==='plan_state'&&e.summary.startsWith('Abandoned'))).toHaveLength(1);
 choose(g,'rest',100010);expect(a.learning?.active).toBeUndefined();
});
test('suspended and duplicate evidence cannot finish a retained routine',()=>{
 const g=fixture(),a=pendingPlan(g),l=a.learning!;choose(g,'rest',100000);
 confirmStep(l,'walk:garden','unrelated');expect(l.active?.index).toBe(1);
 selectPlan(l,'walk:garden');confirmStep(l,'walk:garden','arrival:final');confirmStep(l,'walk:garden','arrival:final');
 expect(l.active).toBeUndefined();expect(l.routines[0].successes).toBe(1);
 expect(()=>parseAction('{"action":"rest","reason":"recover","abandonPlan":"yes"}',[{id:'rest',kind:'rest',label:'Rest',score:1}])).toThrow();
});
function fixture(hour=20){
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
function choose(g:Game,action:string,now:number,index=0){const a=[...g.world.agents.values()][index];a.inProgressOperation={name:'agentChooseAction',operationId:'test:'+now+':'+index,started:now};agentInputs.finishDecision.handler(g,now,{agentId:a.id,operationId:a.inProgressOperation.operationId,action,reason:'A test intention',source:'model'});return a;}
function tick(g:Game,now:number){g.numPathfinds=0;g.tick(now);g.pendingOperations=[];}

test('full energy removes rest, sleep and continuing an old rest; stale recovery requests become a walk',()=>{
 const g=fixture(),n=g.world.livelihood!.needs[0];n.energy=100;n.restedness=100;
 const a=[...g.world.agents.values()][0];a.decision={kind:'rest',label:'Old rest',reason:'Old reason',source:'model',chosenAt:1,until:200000};
 const options=availableActions({...g.world.serialize(),currentDecision:a.decision},a.playerId,100000);
 expect(options.some(o=>['rest','sleep','continue'].includes(o.id))).toBe(false);
 choose(g,'rest',100000);expect(a.decision?.kind).toBe('wander');expect(g.world.players.get(a.playerId)?.pathfinding).toBeDefined();
});
test('a previously stored full-energy rest ends and schedules exactly one new decision',()=>{
 const g=fixture(),a=[...g.world.agents.values()][0];g.world.livelihood!.needs[0].energy=100;
 a.decision={kind:'rest',label:'Old rest',reason:'Old reason',source:'model',chosenAt:1,until:200000};a.nextDecisionAt=200000;
 a.tick(g,100000);expect(a.decision?.until).toBe(100000);expect(a.inProgressOperation?.name).toBe('agentChooseAction');
 const op=a.inProgressOperation?.operationId;a.tick(g,100016);expect(a.inProgressOperation?.operationId).toBe(op);
});
test('rest finishes at 70 energy or after a village hour, without offline time shortening it',()=>{
 const g=fixture(),a=choose(g,'rest',100000),c=g.world.clock!;
 c.elapsedMs+=30000;g.world.livelihood!.needs[0].energy=60;a.tick(g,9999999);expect(a.inProgressOperation).toBeUndefined();
 c.elapsedMs+=30000;a.tick(g,10000000);expect(a.inProgressOperation?.name).toBe('agentChooseAction');
 const h=fixture(),b=choose(h,'rest',100000);h.world.livelihood!.needs[0].energy=70;b.tick(h,100100);expect(b.inProgressOperation?.name).toBe('agentChooseAction');
});
test('sleep is optional at night, is a daytime option only when exhausted, and respects commitments and cooldown',()=>{
 const g=fixture(12),owner=owners[0],list=()=>availableActions(g.world.serialize(),owner,100000);
 expect(list().some(o=>o.id==='sleep')).toBe(false);g.world.livelihood!.needs[0].energy=20;expect(list().some(o=>o.id==='sleep')).toBe(true);
 g.world.clock!.elapsedMs=12*WORLD_HOUR_MS;g.world.livelihood!.needs[0].energy=60;expect(list().some(o=>o.id==='sleep')).toBe(true);
 expect(availableActions({...g.world.serialize(),lastWakeClock:g.world.clock!.elapsedMs},owner,100000).some(o=>o.id==='sleep')).toBe(false);
 g.world.livelihood!.activities=[{id:1,activity:'visit',placeId:'home-0',proposer:owner,participants:owners.slice(0,2),acceptedBy:owners.slice(0,2),created:0,due:5000,expires:100000,status:'scheduled',ate:[]}];expect(list().some(o=>o.id==='sleep')).toBe(false);
});
test('sleep requires a real walk home; travel consumes energy and only arrival starts recovery',()=>{
 const g=fixture(),a=choose(g,'sleep',100000),n=g.world.livelihood!.needs[0],p=g.world.players.get(a.playerId)!;
 expect(a.sleep?.phase).toBe('going_home');expect(p.position).toEqual({x:2,y:3});expect(p.pathfinding?.destination).toEqual({x:2,y:6});
 let now=100000;for(;now<130000;now+=16){tick(g,now);if(a.sleep?.phase==='asleep')break;}
 expect(a.sleep?.phase).toBe('asleep');expect(Math.hypot(p.position.x-2,p.position.y-6)).toBeLessThanOrEqual(.65);expect(n.energy).toBeLessThan(40);
 const start=n.energy;for(let i=0;i<3750;i++)tick(g,now+=16);
 expect(n.energy-start).toBeCloseTo(10,1);expect(a.inProgressOperation).toBeUndefined();expect(p.pathfinding).toBeUndefined();
 const restored=new Agent(a.serialize());expect(restored.sleep).toEqual(a.sleep);
});
test('sleep blocks invitations, wakes for urgent hunger, and never traps a blocked journey',()=>{
 const g=fixture(),a=choose(g,'sleep',100000);a.sleep!.phase='asleep';a.sleep!.started=g.world.clock!.elapsedMs;a.sleep!.wakeAt=g.world.clock!.elapsedMs+8*WORLD_HOUR_MS;
 expect(Conversation.start(g,100000,g.world.players.get('p:1' as any)!,g.world.players.get(a.playerId)!)).toHaveProperty('error');
 g.world.livelihood!.needs[0].hunger=95;g.world.livelihood!.needs[0].energy=30;a.tick(g,100100);expect(a.sleep).toBeUndefined();expect(g.world.livelihood!.jobs[0]?.kind).toBe('eat');
 const h=fixture(),b=choose(h,'sleep',100000);h.world.clock!.elapsedMs+=2*WORLD_HOUR_MS;b.tick(h,200000);expect(b.sleep).toBeUndefined();expect(b.inProgressOperation?.name).toBe('agentChooseAction');
});
test('night sleep wakes recovered residents after six hours and always ends by eight hours',()=>{
 const g=fixture(),a=choose(g,'sleep',100000),start=g.world.clock!.elapsedMs;
 a.sleep={phase:'asleep',home:{x:2,y:6},requested:start,started:start,wakeAt:start+8*WORLD_HOUR_MS};g.world.livelihood!.needs[0].energy=100;g.world.livelihood!.needs[0].restedness=100;
 g.world.clock!.elapsedMs=start+3*WORLD_HOUR_MS;a.tick(g,100001);expect(a.sleep?.phase).toBe('asleep');
 g.world.clock!.elapsedMs=start+6*WORLD_HOUR_MS;a.tick(g,100002);expect(a.sleep).toBeUndefined();expect(a.lastWakeClock).toBe(start+6*WORLD_HOUR_MS);
 const h=fixture(),b=choose(h,'sleep',100000),begin=h.world.clock!.elapsedMs;b.sleep={phase:'asleep',home:{x:2,y:6},requested:begin,started:begin,wakeAt:begin+8*WORLD_HOUR_MS};
 h.world.clock!.elapsedMs=begin+8*WORLD_HOUR_MS;b.tick(h,100001);expect(b.sleep).toBeUndefined();expect(b.inProgressOperation?.name).toBe('agentChooseAction');
});

test('pause/resume preserves village time and sleep, discards wall-clock downtime and displays sleeping state',()=>{
 const g=fixture(),a=choose(g,'sleep',100000),world=g.world.serialize();world.clock!.lastTick=100000;
 const restored=resumeState(world);advanceWorldClock(restored.clock!,999999999);expect(restored.clock!.elapsedMs).toBe(world.clock!.elapsedMs);expect(restored.agents[0].sleep).toEqual(a.sleep);
 expect(residentActivity({running:true,now:1,pathfinding:{},sleep:{phase:'going_home'}})).toBe('Going home to sleep');
 expect(residentActivity({running:true,now:1,sleep:{phase:'asleep'}})).toBe('Sleeping at home');
});

test('a full 24-hour engine cycle supports three residents walking, eating, sleeping and waking with bounded needs',()=>{
 const g=fixture(8);for(const n of g.world.livelihood!.needs){n.energy=70;n.hunger=20;}
 const seen=new Map(owners.map(id=>[id,new Set<string>()]));let highRest=false;let maxHunger=0;
 // Deterministic menu selections exercise the actual engine without paid model calls.
 for(let now=100000;now<=100000+WORLD_DAY_MS;now+=250){
  tick(g,now);
  for(const [i,a] of [...g.world.agents.values()].entries()){
   const n=g.world.livelihood!.needs[i],p=g.world.players.get(a.playerId)!;maxHunger=Math.max(maxHunger,n.hunger);
   if(a.sleep)seen.get(a.playerId)!.add(a.sleep.phase);if(p.pathfinding)seen.get(a.playerId)!.add('walking');
   if(a.decision?.kind==='rest'&&n.energy>=70&&a.decision.until>now)highRest=true;
   if(a.inProgressOperation?.name!=='agentChooseAction')continue;
   const options=availableActions({...g.world.serialize(),currentDecision:a.decision,lastWakeClock:a.lastWakeClock},a.playerId,now);
   const selected=(n.hunger>=40?options.find(o=>o.id==='eat:meals'):undefined)??options.find(o=>o.id==='sleep')??(n.energy<40?options.find(o=>o.id==='rest'):undefined)??options.find(o=>o.id===(Math.floor(now/60000)%2?'walk:river':'walk:garden'))!;
   choose(g,selected.id,now,i);
  }
 }
 expect(worldTime(g.world.clock!.elapsedMs)).toMatchObject({day:2,hour:8});expect(highRest).toBe(false);expect(maxHunger).toBeLessThan(90);
 expect(g.world.livelihood!.events.some(e=>e.kind==='wake')).toBe(true);
 for(const id of owners){expect(seen.get(id)).toEqual(new Set(['walking','going_home','asleep']));expect(g.world.livelihood!.events.some(e=>e.kind==='eat'&&e.witnesses.includes(id))).toBe(true);expect(g.world.livelihood!.events.some(e=>e.kind==='wake'&&e.witnesses.includes(id))).toBe(true);}
 for(const n of g.world.livelihood!.needs){expect(n.energy).toBeGreaterThan(0);expect(n.energy).toBeLessThanOrEqual(100);}
 const bags=g.world.economy!.bags;expect(bags.reduce((n,b)=>n+(b.items.meals??0),0)+g.world.livelihood!.consumed.meals).toBe(12);
},30000);

test('all-night sleep debt cannot be erased by energy, food or repeated short rests',()=>{
 const g=fixture(),n=g.world.livelihood!.needs[0];n.restedness=100;n.energy=100;
 for(let i=1;i<=17*60;i++)advanceNeeds(g.world.livelihood!,i*1000,()=> 'idle');
 expect(n.restedness).toBeCloseTo(0);expect(eat(g.world.livelihood!,g.world.economy!,owners[0],'meals',1)).toBe(true);advanceNeeds(g.world.livelihood!,17*60000+1000,()=> 'idle');n.energy=100;
 let options=availableActions(g.world.serialize(),owners[0],200000);expect(options.map(o=>o.id)).toEqual(['sleep']);
 const a=[...g.world.agents.values()][0];a.tick(g,200000);const operation=a.inProgressOperation?.operationId;a.tick(g,200016);expect(a.inProgressOperation?.operationId).toBe(operation);
 agentInputs.finishDecision.handler(g,200020,{agentId:a.id,operationId:operation!,action:'sleep',reason:'I need proper sleep',source:'model'});expect(a.sleep?.phase).toBe('going_home');
 const h=fixture(),other=h.world.livelihood!.needs[0];other.restedness=50;other.energy=20;
 for(let i=1;i<=240;i++)advanceNeeds(h.world.livelihood!,i*1000,()=> 'rest');
 expect(other.energy).toBeCloseTo(100);expect(other.restedness).toBeCloseTo(42);
});
test('low restedness blocks new demanding work while urgent food remains available',()=>{
 const g=fixture();g.world.livelihood!.needs[1].restedness=14;g.world.livelihood!.needs[1].energy=100;g.world.economy!.bags[1].items.rod=1;
 const options=availableActions(g.world.serialize(),owners[1],100000);
 expect(options.some(o=>['fish','cook','garden','market','offer','continue'].includes(o.kind))).toBe(false);
 g.world.livelihood!.needs[1].hunger=95;expect(availableActions(g.world.serialize(),owners[1],100000).some(o=>o.id==='eat:meals')).toBe(true);
});
test('daytime naps are capped at four hours, but severe deprivation allows longer recovery',()=>{
 const g=fixture(12),n=g.world.livelihood!.needs[0],p=g.world.players.get('p:0' as any)!;n.restedness=25;p.position={x:2,y:6};
 const a=choose(g,'sleep',100000);a.tick(g,100000);expect(a.sleep).toMatchObject({mode:'nap',minimumHours:2,plannedHours:4});
 g.world.clock!.elapsedMs+=4*WORLD_HOUR_MS;a.tick(g,100001);expect(a.sleep).toBeUndefined();
 const h=fixture(12);h.world.livelihood!.needs[0].restedness=5;h.world.players.get('p:0' as any)!.position={x:2,y:6};
 const b=choose(h,'sleep',100000);b.tick(h,100000);expect(b.sleep).toMatchObject({mode:'recovery',plannedHours:8});
});
test('casual encounters require proximity and consent, preserve routes and work, and have a bounded ending',()=>{
 const g=fixture(12),p=g.world.players.get('p:0' as any)!,other=g.world.players.get('p:1' as any)!;other.position={x:3,y:3};
 const garden=g.world.garden!;garden.beds=[{id:0,x:2,y:3,state:'empty'}];garden.seeds=1;garden.job={kind:'plant',bed:0,requested:0};
 movePlayer(g,100000,p,{x:15,y:3});const route=p.pathfinding;
 const normal=Conversation.start(g,100000,p,other);expect(normal).toHaveProperty('error');
 const result=Conversation.start(g,100000,p,other,true),c=g.world.conversations.get(result.conversationId!)!;
 expect(c.participants.get(other.id)?.status.kind).toBe('invited');c.acceptInvite(g,other);c.tick(g,100001);
 expect(c.participants.get(p.id)?.status.kind).toBe('participating');expect(p.pathfinding).toBe(route);expect(garden.job).toBeDefined();
 const restored=new Conversation(c.serialize());expect(restored.casual).toBe(true);
 c.numMessages=4;c.tick(g,100002);expect(g.world.conversations.size).toBe(0);expect(p.pathfinding).toBe(route);expect(garden.job).toBeDefined();
 other.position={x:19,y:19};expect(Conversation.start(g,100003,p,other,true)).toHaveProperty('error');
});

test('casual conversation continues garden work and does not cancel its path while a reply is generated',()=>{
 const g=fixture(12),p=g.world.players.get('p:0' as any)!,other=g.world.players.get('p:1' as any)!;other.position={x:3,y:3};
 const garden=g.world.garden!;garden.seeds=1;garden.beds=[{id:0,x:2,y:3,state:'empty'}];garden.job={kind:'plant',bed:0,requested:0};
 const result=Conversation.start(g,100000,p,other,true),c=g.world.conversations.get(result.conversationId!)!;c.acceptInvite(g,other);c.tick(g,100001);
 const a=[...g.world.agents.values()][0];a.tick(g,100001);expect(garden.job?.started).toBeDefined();expect(a.inProgressOperation?.name).toBe('agentGenerateMessage');
 garden.time=5000;a.tick(g,100017);expect(garden.beds[0].state).toBe('growing');expect(garden.seeds).toBe(0);expect(g.world.conversations.size).toBe(1);
});

test('a courtyard visit accepts ordinary conversation rather than rejecting it as work',()=>{
 const g=fixture(12),a=[...g.world.agents.values()][0],p=g.world.players.get(a.playerId)!,other=g.world.players.get('p:1' as any)!;other.position={x:3,y:3};
 a.decision={kind:'place',label:'Visit courtyard',reason:'Find company',source:'model',chosenAt:90000,until:190000};
 const result=Conversation.start(g,100000,other,p),c=g.world.conversations.get(result.conversationId!)!;
 const random=Math.random;try{Math.random=()=>0;a.tick(g,100001);}finally{Math.random=random;}
 expect(c.participants.get(p.id)?.status.kind).toBe('walkingOver');expect(g.world.conversations.size).toBe(1);
});
test('moving or physically occupied neighbours offer casual chat rather than a conflicting long conversation',()=>{
 const g=fixture(12),a=[...g.world.agents.values()][0];a.awareness=initialAwareness();a.awareness.visible=['p:1'];a.awareness.lastSeen=[{id:'p:1',position:{x:3,y:3},at:1}];
 g.world.players.get('p:1' as any)!.position={x:3,y:3};g.world.economy!.jobs.push({owner:'p:1',kind:'fish',requested:0});
 const menu=availableActions({...g.world.serialize(),awareness:a.awareness},a.playerId,100000);
 expect(menu.some(o=>o.id==='casual:p:1')).toBe(true);expect(menu.some(o=>o.id==='talk:p:1')).toBe(false);
});
