import {BobLuckyFlow} from '../convex/prototypes/bobLuckyFlow';
import {Agent} from '../convex/aiTown/agent';
import {Conversation} from '../convex/aiTown/conversation';

function fixture(){const f=new BobLuckyFlow();return {f,a:f.agent('Lucky'),p:f.player('Lucky')};}
function command(f:BobLuckyFlow,destination:{x:number;y:number}|null){
  return f.game.handleInput(f.now,'moveResidentTo',{playerId:f.agent('Lucky').playerId,destination});
}

test('walks around a building, survives serialization, then releases AI control',()=>{
  const {f,a,p}=fixture();
  f.game.worldMap.villageObstacles=[{x:7,y:3,w:1,h:3}];
  a.inProgressOperation={operationId:'stale-choice',name:'agentChooseAction',started:f.now};
  command(f,{x:10,y:4});
  expect(f.game.world.conversations.size).toBe(0);
  expect(a.inProgressOperation).toBeUndefined();
  const loaded=new Agent(a.serialize());f.game.world.agents.set(a.id,loaded);
  const start=f.now,clock=f.game.world.clock!.elapsedMs;
  let detoured=false;
  for(let ms=0;ms<=20000;ms+=100){
    f.now=start+ms;f.game.world.clock!.elapsedMs=clock+ms;f.game.numPathfinds=0;
    p.tickPathfinding(f.game,f.now);p.tickPosition(f.game,f.now);loaded.tick(f.game,f.now);
    if(p.position.y!==4)detoured=true;
    expect(p.position.x>=7&&p.position.x<8&&p.position.y>=3&&p.position.y<6).toBe(false);
    expect(f.game.pendingOperations).toHaveLength(0);
    if(!loaded.manualMove)break;
  }
  expect(detoured).toBe(true);
  expect(p.position).toEqual({x:10,y:4});
  expect(loaded.manualMove).toBeUndefined();
  expect(loaded.nextDecisionAt).toBe(f.now+2000);
});

test('blocked or unreachable destinations do not interrupt the existing conversation',()=>{
  const {f,a}=fixture();
  f.game.worldMap.villageObstacles=[{x:7,y:0,w:1,h:20}];
  for(const destination of [{x:-1,y:4},{x:7,y:4},{x:10,y:4},{x:Infinity,y:4}]){
    expect(()=>command(f,destination)).toThrow();
    expect(f.game.world.conversations.has(f.conversationId!)).toBe(true);
    expect(a.manualMove).toBeUndefined();
  }
});

test('another destination replaces the manual walk; stop releases it',()=>{
  const {f,a,p}=fixture();command(f,{x:10,y:4});command(f,{x:6,y:8});
  expect(p.pathfinding?.destination).toEqual({x:6,y:8});
  command(f,null);
  expect(a.manualMove).toBeUndefined();expect(p.pathfinding).toBeUndefined();
});

test('late model decisions cannot replace a directed walk',()=>{
  const {f,a,p}=fixture();
  a.inProgressOperation={name:'agentChooseAction',operationId:'late',started:f.now};
  command(f,{x:10,y:4});
  f.game.handleInput(f.now,'finishDecision',{agentId:a.id,operationId:'late',action:'wander',reason:'Old reply',source:'model'});
  expect(a.manualMove?.destination).toEqual({x:10,y:4});
  expect(p.pathfinding?.destination).toEqual({x:10,y:4});
});

test('new conversations cannot interrupt a directed walk',()=>{
  const {f}=fixture();command(f,{x:10,y:4});
  expect(Conversation.start(f.game,f.now,f.player('Bob'),f.player('Lucky')).error).toContain('directed walk');
});

test('accepted exchanges are not silently cancelled or stripped of escrow',()=>{
  const {f,a}=fixture();const life=f.game.world.livelihood!;
  life.offers.push({id:99,status:'accepted',participants:[a.playerId],escrow:[{owner:a.playerId,item:'fish',quantity:1}]} as any);
  const before=JSON.stringify(life.offers);
  expect(()=>command(f,{x:10,y:4})).toThrow('agreed activity');
  expect(JSON.stringify(life.offers)).toBe(before);expect(a.manualMove).toBeUndefined();
});

test('waking for a directed walk does not refill needs',()=>{
  const {f,a}=fixture();
  a.sleep={phase:'asleep'} as any;
  const before=JSON.stringify(f.game.world.livelihood!.needs);
  command(f,{x:10,y:4});
  expect(a.sleep).toBeUndefined();expect(JSON.stringify(f.game.world.livelihood!.needs)).toBe(before);
});
