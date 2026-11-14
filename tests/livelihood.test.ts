import {Economy,emptyItems} from '../convex/aiTown/economyState';
import {livelihood,createOffer,respondOffer,settleOffers,foodCount,advanceNeeds,eat,RECIPES,validTerms,addFood} from '../convex/aiTown/livelihoodState';
import {livelihoodWork} from '../convex/aiTown/livelihoodRuntime';
import {lifeActions} from '../convex/aiTown/livelihoodActions';
import {availableActions} from '../convex/aiTown/actionChoice';
import {Garden,workGarden,tickGarden} from '../convex/aiTown/gardenState';
const owners=['p:0','p:1','p:2'];
function economy():Economy{return {merchant:'p:2',fisher:'p:1',market:{x:5,y:5},bank:{x:10,y:10},water:{x:12,y:10},bags:owners.map((owner,i)=>({owner,items:{...emptyItems(),turnips:i===0?8:0,fish:i===1?4:0,meals:i===2?4:0,rod:i===1?1:0}})),marketStock:emptyItems(),population:4,lastRecovery:0,rng:12345,jobs:[],nextFish:0,events:[],nextEvent:0};}
function garden():Garden{return {owner:'p:0',home:{x:1,y:1},origin:{x:0,y:0},time:0,seeds:2,food:0,nextJob:0,renewableSeeds:true,beds:[{id:0,x:2,y:5,state:'empty'},{id:1,x:4,y:5,state:'empty'}],events:[],nextEvent:0};}
function barter(){return {kind:'barter' as const,proposer:'p:0',participants:['p:0','p:1'],inputs:[{owner:'p:0',item:'turnips' as const,quantity:2},{owner:'p:1',item:'fish' as const,quantity:1}],outputs:[{owner:'p:1',item:'turnips' as const,quantity:2},{owner:'p:0',item:'fish' as const,quantity:1}]};}
function stew(){return {kind:'cook' as const,proposer:'p:2',participants:owners,inputs:[{owner:'p:0',item:'turnips' as const,quantity:2},{owner:'p:1',item:'fish' as const,quantity:1}],outputs:owners.map(owner=>({owner,item:'meals' as const,quantity:1})),cook:'p:2',recipe:'mixed' as const};}
test('a proposal moves no goods; consent reserves both sides, and meeting settles exactly once',()=>{
  const e=economy(),l=livelihood(owners,0),o=createOffer(l,e,barter(),1000)!;
  expect(foodCount(e,'p:0','turnips')).toBe(8);expect(o.escrow).toHaveLength(0);
  expect(respondOffer(l,e,o.id,'p:2','accept',1000)).toBe(false);
  expect(respondOffer(l,e,o.id,'p:1','accept',1000)).toBe(true);
  expect(foodCount(e,'p:0','turnips')).toBe(6);expect(foodCount(e,'p:0','fish')).toBe(0);
  settleOffers(l,e,2000,()=>false);expect(o.status).toBe('accepted');
  settleOffers(l,e,3000,()=>true);expect(foodCount(e,'p:0','fish')).toBe(1);expect(foodCount(e,'p:1','turnips')).toBe(2);
  settleOffers(l,e,4000,()=>true);expect(foodCount(e,'p:1','turnips')).toBe(2);expect(o.status).toBe('completed');
});
test('acceptance rechecks all inventories and cannot partially reserve a broken agreement',()=>{
  const e=economy(),l=livelihood(owners,0),o=createOffer(l,e,barter(),0)!;e.bags[0].items.turnips=0;
  expect(respondOffer(l,e,o.id,'p:1','accept',1000)).toBe(false);expect(foodCount(e,'p:1','fish')).toBe(4);expect(o.escrow).toEqual([]);
});
test('expired reservations return every item to the original owner once',()=>{
  const e=economy(),l=livelihood(owners,0),o=createOffer(l,e,barter(),0)!;
  respondOffer(l,e,o.id,'p:1','accept',0);l.clock=300000;settleOffers(l,e,300000,()=>false);
  expect(o.status).toBe('expired');expect(foodCount(e,'p:0','turnips')).toBe(8);expect(foodCount(e,'p:1','fish')).toBe(4);
  settleOffers(l,e,300001,()=>true);expect(foodCount(e,'p:0','turnips')).toBe(8);
});
test('counteroffers replace rather than execute the previous offer and stop after two counters',()=>{
  const e=economy(),l=livelihood(owners,0);const first=createOffer(l,e,barter(),0)!;
  expect(respondOffer(l,e,first.id,'p:1','counter',1000)).toBe(true);expect(first.status).toBe('countered');
  const second=l.offers.at(-1)!;expect(second.inputs.find(g=>g.owner==='p:0')!.quantity).toBe(3);
  expect(respondOffer(l,e,second.id,'p:0','counter',2000)).toBe(true);
  const third=l.offers.at(-1)!;expect(third.counters).toBe(2);expect(respondOffer(l,e,third.id,'p:1','counter',3000)).toBe(false);
  expect(e.bags[0].items.turnips).toBe(8);
});
test('three-person cooking needs all consents and ingredients, then real preparation time',()=>{
  const e=economy(),l=livelihood(owners,0),o=createOffer(l,e,stew(),0)!;
  respondOffer(l,e,o.id,'p:0','accept',0);expect(o.status).toBe('open');expect(e.bags[0].items.turnips).toBe(8);
  respondOffer(l,e,o.id,'p:1','accept',0);expect(o.status).toBe('accepted');
  settleOffers(l,e,1000,owner=>owner!=='p:2');expect(o.status).toBe('accepted');
  settleOffers(l,e,2000,()=>true);expect(o.status).toBe('cooking');
  l.clock=15999;settleOffers(l,e,17999,()=>true);expect(foodCount(e,'p:0','meals')).toBe(0);
  l.clock=16000;settleOffers(l,e,18000,()=>true);
  expect(owners.map(owner=>foodCount(e,owner,'meals'))).toEqual([1,1,5]);expect(l.consumed.turnips).toBe(2);expect(l.consumed.fish).toBe(1);expect(l.produced.meals).toBe(3);
});
test('invalid recipes, counterfeit output, duplicate inputs and self-trades are rejected',()=>{
  const e=economy();const b=barter();
  expect(validTerms(e,{...b,outputs:[{owner:'p:0',item:'fish',quantity:999}]})).toBe(false);
  expect(validTerms(e,{...b,participants:['p:0','p:0']})).toBe(false);
  expect(validTerms(e,{...b,inputs:[...b.inputs,b.inputs[0]]})).toBe(false);
  expect(validTerms(e,{...stew(),outputs:[{owner:'p:0',item:'meals',quantity:99}]})).toBe(false);
  expect(validTerms(e,{...stew(),cook:'p:0'})).toBe(false);
});
test('a gift still requires consent and transfers only the offered goods',()=>{
  const e=economy(),l=livelihood(owners,0),o=createOffer(l,e,{kind:'gift',proposer:'p:0',participants:['p:0','p:1'],inputs:[{owner:'p:0',item:'turnips',quantity:1}],outputs:[{owner:'p:1',item:'turnips',quantity:1}]},0)!;
  expect(foodCount(e,'p:1','turnips')).toBe(0);respondOffer(l,e,o.id,'p:1','accept',0);settleOffers(l,e,0,()=>true);
  expect(foodCount(e,'p:1','turnips')).toBe(1);expect(foodCount(e,'p:1','fish')).toBe(4);
});
test('hunger and energy use simulation time, and eating consumes inventory without eating raw fish',()=>{
  const e=economy(),l=livelihood(owners,0),before=l.needs[0].hunger;
  advanceNeeds(l,0,()=> 'work');expect(l.needs[0].hunger).toBe(before);
  for(let i=1;i<=60;i++)advanceNeeds(l,i*1000,()=> 'work');
  expect(l.needs[0].hunger).toBeGreaterThan(before);expect(l.needs[0].energy).toBeLessThan(80);
  expect(eat(l,e,'p:0','turnips',0)).toBe(true);expect(e.bags[0].items.turnips).toBe(7);
  expect(eat(l,e,'p:1','fish',0)).toBe(false);expect(e.bags[1].items.fish).toBe(4);
  const energy=l.needs[0].energy;for(let i=61;i<=100;i++)advanceNeeds(l,i*1000,()=> 'rest');expect(l.needs[0].energy).toBeGreaterThan(energy);
});
test('offers do not reveal a partner private stock and new menus retire fixed seed prices',()=>{
  const e=economy(),l=livelihood(owners,0),g=garden(),w={players:owners.map(id=>({id,position:{x:1,y:1}})),conversations:[],economy:e,garden:g,livelihood:l};
  const before=lifeActions(w,'p:0').filter(o=>o.kind==='offer').map(o=>o.id);
  e.bags[1].items.fish=0;e.bags[2].items.meals=0;
  expect(lifeActions(w,'p:0').filter(o=>o.kind==='offer').map(o=>o.id)).toEqual(before);
  expect(availableActions(w,'p:0',100000).some(o=>o.id==='trade')).toBe(false);
});
test('cooking and gathering require arrival and time; failed cooking grants no meal',()=>{
  const e=economy(),l=livelihood(owners,0),g=garden(),p={id:'p:0',position:{x:2,y:4},speed:0};
  const game:any={world:{economy:e,livelihood:l,garden:g,players:new Map([['p:0',p]]),playerConversation:()=>undefined}};
  l.jobs.push({owner:'p:0',kind:'cook',recipe:'vegetable',requested:0});livelihoodWork(game,'p:0',0);expect(foodCount(e,'p:0','meals')).toBe(0);
  e.bags[0].items.turnips=0;l.clock=15000;livelihoodWork(game,'p:0',15000);expect(foodCount(e,'p:0','meals')).toBe(0);expect(l.jobs).toHaveLength(0);
});
test('renewable harvesting returns planting seed without growing during a pause',()=>{
  const g=garden();g.beds[0].state='ready';g.seeds=0;workGarden(g,{x:2,y:5},0);g.time=4000;workGarden(g,{x:2,y:5},4000);
  expect(g.seeds).toBe(1);expect(g.food).toBe(2);
  tickGarden(g,1000);const before=g.time;tickGarden(g,1000000);expect(g.time-before).toBeLessThanOrEqual(250);
});

// Long-run accounting/needs tests use an explicit headless policy, not LLM calls or claims about emergent behavior.
test.each([false,true])('twenty simulated days remain viable with cook unavailable=%s',unavailable=>{
  const e=economy(),l=livelihood(owners,0);for(const b of e.bags){b.items.turnips=0;b.items.fish=0;b.items.meals=0;}
  let completed=0,maxHunger=0,invalidState=false;
  for(let clock=1000;clock<=20*20*60000;clock+=1000){
    advanceNeeds(l,clock,()=> 'rest');
    // Sustainable emergency gathering: one root per resident per three minutes.
    for(const n of l.needs)if(clock-n.lastForage>=180000){addFood(e,n.owner,'turnips',1);l.produced.turnips++;n.lastForage=clock;}
    // Specialists' conservative production budgets; storage is bounded.
    if(clock%120000===0){if(foodCount(e,'p:0','turnips')<6){addFood(e,'p:0','turnips',2);l.produced.turnips+=2;}if(foodCount(e,'p:1','fish')<4){addFood(e,'p:1','fish',1);l.produced.fish++;}}
    if(!unavailable&&clock%240000===0&&foodCount(e,'p:0','turnips')>=2&&foodCount(e,'p:1','fish')>=1){
      const o=createOffer(l,e,stew(),clock);if(o){respondOffer(l,e,o.id,'p:0','accept',clock);respondOffer(l,e,o.id,'p:1','accept',clock);}
    }
    const before=l.offers.filter(o=>o.status==='completed').length;settleOffers(l,e,clock,()=>!unavailable);completed+=Math.max(0,l.offers.filter(o=>o.status==='completed').length-before);
    for(const n of l.needs){if(n.hunger>=40){if(foodCount(e,n.owner,'meals')>0)eat(l,e,n.owner,'meals',clock);else if(foodCount(e,n.owner,'turnips')>0)eat(l,e,n.owner,'turnips',clock);}}
    for(const n of l.needs){maxHunger=Math.max(maxHunger,n.hunger);if(!Number.isFinite(n.hunger)||n.energy<0||n.energy>100)invalidState=true;}
    for(const b of e.bags)for(const q of Object.values(b.items))if(!Number.isSafeInteger(q)||q!<0)invalidState=true;
  }
  expect(invalidState).toBe(false);expect(maxHunger).toBeLessThan(90);
  if(!unavailable)expect(completed).toBeGreaterThan(10);
  expect(l.needs.every(n=>n.hunger<90)).toBe(true);
  for(const item of ['turnips','fish','meals'] as const){
    const held=e.bags.reduce((n,b)=>n+(b.items[item]??0),0)+l.offers.reduce((n,o)=>n+o.escrow.filter(g=>g.item===item).reduce((n,g)=>n+g.quantity,0),0);
    expect(held).toBe(l.produced[item]-l.consumed[item]);
  }
});
