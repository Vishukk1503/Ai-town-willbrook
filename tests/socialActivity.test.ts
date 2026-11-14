import {proposeActivity,respondActivity,tickSocialActivities,socialActivityWork} from '../convex/aiTown/socialActivity';
import {livelihood,createOffer,respondOffer,settleOffers} from '../convex/aiTown/livelihoodState';
import {emptyItems} from '../convex/aiTown/economyState';
function fixture(){
  const owners=['p:0','p:1','p:2'],life=livelihood(owners,0);
  for(const n of life.needs)n.hunger=60;
  const economy={merchant:'p:2',fisher:'p:1',market:{x:5,y:5},bank:{x:12,y:6},water:{x:13,y:6},bags:owners.map((owner,i)=>({owner,items:{...emptyItems(),turnips:i===0?2:0,fish:i===1?1:0,meals:1}})),jobs:[],events:[],nextEvent:0};
  const players=new Map(owners.map(id=>[id,{id,position:{x:6,y:6},speed:0}]));
  const garden={owner:'p:0',home:{x:1,y:1},origin:{x:0,y:0},time:0,seeds:2,food:0,nextJob:0,beds:[{id:0,x:3,y:6,state:'ready'}],events:[],nextEvent:0};
  const game:any={world:{livelihood:life,economy,garden,players,conversations:new Map(),village:{places:[{id:'tavern',name:'Tavern',kind:'tavern',entrance:{x:6,y:6}}]},playerConversation:()=>undefined}};
  return {game,life,economy,players,garden};
}
test('an invitation does not consume food or move anyone before consent',()=>{
  const {game,life,economy,players}=fixture();players.get('p:1')!.position={x:12,y:6};
  expect(proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},1000)).toBe(true);
  expect(life.activities![0]).not.toHaveProperty('delayMinutes');
  tickSocialActivities(game,2000);expect(life.activities![0].status).toBe('proposed');
  expect(economy.bags[1].items.meals).toBe(1);expect(socialActivityWork(game,'p:1',2000)).toBeNull();
  expect(respondActivity(game,0,'p:0','accept',2000)).toBe(false);
});
test('accepted appointments use simulation time, and cancellation prevents execution',()=>{
  const {game,life}=fixture();proposeActivity(game,'p:1','p:2',{activity:'visit',placeId:'tavern',delayMinutes:3},0);
  respondActivity(game,0,'p:2','accept',1);tickSocialActivities(game,9999999);
  expect(life.activities![0].status).toBe('scheduled');
  life.clock=3000;tickSocialActivities(game,10000000);expect(life.activities![0].status).toBe('active');
  expect(respondActivity(game,0,'p:1','cancel',10000001)).toBe(true);
  life.clock+=20000;tickSocialActivities(game,10020000);expect(life.activities![0].status).toBe('cancelled');
});
test('shared meals require arrival, real duration and actual food; each participant eats once',()=>{
  const {game,life,economy,players}=fixture();players.get('p:1')!.position={x:12,y:6};
  proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},0);respondActivity(game,0,'p:2','accept',1);
  tickSocialActivities(game,2);expect(life.activities![0].status).toBe('gathering');
  socialActivityWork(game,'p:1',2);expect((players.get('p:1') as any).pathfinding.destination).toEqual({x:6,y:6});
  players.get('p:1')!.position={x:7,y:6};tickSocialActivities(game,3);expect(life.activities![0].status).toBe('active');
  life.clock=9999;tickSocialActivities(game,4);expect(economy.bags[1].items.meals).toBe(1);
  life.clock=10000;tickSocialActivities(game,5);expect(economy.bags[1].items.meals).toBe(0);expect(life.needs[1].hunger).toBe(22);
  tickSocialActivities(game,6);expect(life.consumed.meals).toBe(2);
  life.clock=20000;tickSocialActivities(game,7);expect(life.activities![0].status).toBe('completed');
});
test('missing portions cancel a meal without inventing inventory or completed eating',()=>{
  const {game,life,economy}=fixture();proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},0);respondActivity(game,0,'p:2','accept',1);
  economy.bags[2].items.meals=0;tickSocialActivities(game,2);
  expect(life.activities![0].status).toBe('cancelled');expect(life.consumed.meals).toBe(0);
});
test('full residents can keep company without a fabricated eating event',()=>{
  const {game,life}=fixture();life.needs[2].hunger=0;
  proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},0);respondActivity(game,0,'p:2','accept',1);tickSocialActivities(game,2);
  life.clock=20000;tickSocialActivities(game,3);expect(life.activities![0].ate).toEqual(['p:1']);expect(life.consumed.meals).toBe(1);
});
test('missed visits and invalid destinations have no successful outcome',()=>{
  const {game,life,players}=fixture();expect(proposeActivity(game,'p:1','p:2',{activity:'walk',placeId:'tavern',destinationId:'unknown',delayMinutes:0},0)).toBe(false);
  proposeActivity(game,'p:1','p:2',{activity:'visit',placeId:'tavern',delayMinutes:0},0);respondActivity(game,0,'p:2','accept',1);players.get('p:1')!.position={x:15,y:15};life.clock=120000;tickSocialActivities(game,2);
  expect(life.activities![0].status).toBe('missed');
});
test('a completed cooking agreement can lead to a separately accepted shared meal',()=>{
  const {game,life,economy}=fixture();economy.bags[1].items.meals=0;economy.bags[2].items.meals=0;
  const o=createOffer(life,economy as any,{kind:'cook',proposer:'p:1',participants:['p:1','p:2'],cook:'p:2',recipe:'fish',inputs:[{owner:'p:1',item:'fish',quantity:1}],outputs:[{owner:'p:1',item:'meals',quantity:1},{owner:'p:2',item:'meals',quantity:1}]},0)!;
  respondOffer(life,economy as any,o.id,'p:2','accept',1);settleOffers(life,economy as any,2,()=>true);life.clock=16000;settleOffers(life,economy as any,3,()=>true);
  expect(o.status).toBe('completed');expect(life.consumed.meals).toBe(0);
  proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},4);respondActivity(game,0,'p:2','accept',5);tickSocialActivities(game,6);
  life.clock=36000;tickSocialActivities(game,7);expect(life.activities![0].status).toBe('completed');expect(life.consumed.meals).toBe(2);expect(economy.bags[1].items.fish).toBe(0);
});
test('a shared walk completes only after both residents reach its destination',()=>{
  const {game,life,players}=fixture();proposeActivity(game,'p:1','p:2',{activity:'walk',placeId:'tavern',destinationId:'river',delayMinutes:0},0);respondActivity(game,0,'p:2','accept',1);tickSocialActivities(game,2);
  expect(life.activities![0].status).toBe('active');socialActivityWork(game,'p:1',3);
  expect((players.get('p:1') as any).pathfinding.destination).toEqual({x:12,y:6});
  players.get('p:1')!.position={x:12,y:6};tickSocialActivities(game,4);expect(life.activities![0].status).toBe('active');
  players.get('p:2')!.position={x:12,y:7};tickSocialActivities(game,5);expect(life.activities![0].status).toBe('completed');
});
test('garden assistance requires physical presence and completes one actual harvest',()=>{
  const {game,life,garden,players}=fixture();proposeActivity(game,'p:0','p:1',{activity:'help',placeId:'garden',delayMinutes:0},0);respondActivity(game,0,'p:1','accept',1);tickSocialActivities(game,2);
  socialActivityWork(game,'p:0',3);expect((players.get('p:0') as any).pathfinding.destination).toEqual({x:3,y:6});
  players.get('p:0')!.position={x:3,y:6};players.get('p:1')!.position={x:4,y:6};tickSocialActivities(game,4);
  expect(garden.food).toBe(0);garden.time=4000;life.clock=4000;tickSocialActivities(game,5);
  expect(life.activities![0].status).toBe('completed');expect(garden.food).toBe(2);expect(life.produced.turnips).toBe(2);
  tickSocialActivities(game,6);expect(garden.food).toBe(2);
});

test('late acceptance and arrival get their own deadline, leaving a complete meal duration',()=>{
 const {game,life,players}=fixture();players.get('p:1')!.position={x:15,y:15};
 proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},0);
 life.clock=119000;expect(respondActivity(game,0,'p:2','accept',1)).toBe(true);
 tickSocialActivities(game,2);expect(life.activities![0].status).toBe('gathering');
 life.clock=178000;players.get('p:1')!.position={x:6,y:6};tickSocialActivities(game,3);expect(life.activities![0].status).toBe('active');
 life.clock=198000;tickSocialActivities(game,4);expect(life.activities![0].status).toBe('completed');
});
test('a walk has a separate execution allowance after both residents gather',()=>{
 const {game,life,players}=fixture();proposeActivity(game,'p:1','p:2',{activity:'walk',placeId:'tavern',destinationId:'river',delayMinutes:0},0);
 life.clock=110000;respondActivity(game,0,'p:2','accept',1);tickSocialActivities(game,2);expect(life.activities![0].status).toBe('active');
 life.clock=200000;players.get('p:1')!.position={x:12,y:6};players.get('p:2')!.position={x:12,y:7};tickSocialActivities(game,3);expect(life.activities![0].status).toBe('completed');
});
test('a full resident cannot initiate a meal, recent meals cannot repeat, and travel can be cancelled',()=>{
 const {game,life}=fixture();life.needs[1].hunger=0;expect(proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},0)).toBe(false);
 life.needs[1].hunger=60;expect(proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},0)).toBe(true);
 respondActivity(game,0,'p:2','accept',1);tickSocialActivities(game,2);life.clock=20000;tickSocialActivities(game,3);
 life.needs[1].hunger=60;expect(proposeActivity(game,'p:1','p:2',{activity:'meal',placeId:'tavern',delayMinutes:0},4)).toBe(false);
 life.clock+=8*60000;expect(proposeActivity(game,'p:1','p:2',{activity:'walk',placeId:'tavern',destinationId:'river',delayMinutes:0},5)).toBe(true);
 respondActivity(game,1,'p:2','accept',6);expect(respondActivity(game,1,'p:1','cancel',7,'I need time alone.')).toBe(true);expect(life.activities![1].outcome).toContain('I need time alone.');expect(life.events.at(-1)?.witnesses).toEqual(['p:1','p:2']);
});
