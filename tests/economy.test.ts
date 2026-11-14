import {Economy,emptyItems,transfer,barter,catchFish} from '../convex/aiTown/economyState';
import {economyWork,tickEconomy} from '../convex/aiTown/economyRuntime';
function economy():Economy{return {merchant:'stella',fisher:'lucky',market:{x:10,y:10},bank:{x:20,y:20},water:{x:22,y:20},bags:[{owner:'bob',items:{...emptyItems(),turnips:2}},{owner:'lucky',items:{...emptyItems(),rod:1}},{owner:'stella',items:emptyItems()}],marketStock:{...emptyItems(),seeds:4},population:2,lastRecovery:0,rng:12345,jobs:[],nextFish:0,events:[],nextEvent:0};}
test('giving conserves owned items and rejects invalid transfers',()=>{
  const e=economy();expect(transfer(e.bags,'bob','lucky','turnips',1)).toBe(true);
  expect(e.bags[0].items.turnips).toBe(1);expect(e.bags[1].items.turnips).toBe(1);
  for(const quantity of [-1,0,1.5,NaN,100])expect(transfer(e.bags,'bob','lucky','turnips',quantity)).toBe(false);
  expect(transfer(e.bags,'bob','bob','turnips',1)).toBe(false);
});
test('barter is atomic and conserves both sides of the exchange',()=>{
  const e=economy();expect(barter(e,'bob','turnips',2)).toBe(true);
  expect(e.bags[0].items).toMatchObject({turnips:0,seeds:2});expect(e.marketStock).toMatchObject({turnips:2,seeds:2});
  const before=JSON.stringify(e);expect(barter(e,'bob','turnips',2)).toBe(false);expect(JSON.stringify(e)).toBe(before);
  e.bags[0].items.turnips=2;e.marketStock.seeds=1;const low=JSON.stringify(e);expect(barter(e,'bob','turnips',2)).toBe(false);expect(JSON.stringify(e)).toBe(low);
});
test('fishing requires a rod and population, and seeded failures create no fish',()=>{
  const e=economy();expect(catchFish(e,'bob')).toBe(false);expect(catchFish(e,'lucky')).toBe(true);
  expect(e.population).toBe(1);expect(e.bags[1].items.fish).toBe(1);
  e.rng=2147483647;expect(catchFish(e,'lucky')).toBe(false);expect(e.population).toBe(1);
  e.population=0;expect(catchFish(e,'lucky')).toBe(false);
});
test('trade requires Stella at the stall and gives both participants an event',()=>{
  const e=economy(),bob={id:'bob',position:{x:11,y:13}},stella={id:'stella',position:{x:50,y:50}};
  e.jobs.push({owner:'bob',kind:'trade',requested:100});
  const game={world:{economy:e,garden:{owner:'bob',time:100,food:0,home:{x:0,y:0}},players:new Map([['bob',bob],['stella',stella]]),playerConversation:()=>undefined},playerDescriptions:new Map([['bob',{name:'Bob'}]])} as any;
  expect(economyWork(game,'bob',1000)).toBe(true);expect(e.marketStock.seeds).toBe(4);
  stella.position={x:11,y:11};economyWork(game,'bob',2000);
  expect(e.marketStock.seeds).toBe(2);expect(e.events[0].witnesses).toEqual(['bob','stella']);expect(e.jobs).toHaveLength(0);
  game.world.garden.time=90000;tickEconomy(game,999999);expect(e.population).toBe(4);
  tickEconomy(game,1999999);expect(e.population).toBe(4);
});
