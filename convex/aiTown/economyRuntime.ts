import type {Game} from './game';
import {movePlayer,stopPlayer} from './movement';
import {Economy,near,barter,catchFish} from './economyState';
export function tickEconomy(game:Game,now:number){
  const e=game.world.economy,g=game.world.garden;if(!e||!g)return;
  const intervals=Math.floor((g.time-e.lastRecovery)/45000);
  if(intervals>0){e.population=Math.min(5,e.population+intervals);e.lastRecovery+=intervals*45000;}
}
export function economyWork(game:Game,owner:string,now:number):boolean{
  const e=game.world.economy,g=game.world.garden,p=game.world.players.get(owner as any);if(!e||!g||!p)return false;
  const bag=e.bags.find(b=>b.owner===owner);if(!bag)return false;
  let job=e.jobs.find(j=>j.owner===owner);
  if(owner===e.merchant){
    const customer=e.jobs.some(j=>j.kind==='trade');
    if(customer&&(!game.world.playerConversation(p)||game.world.playerConversation(p)?.casual)){const counter={x:e.market.x+1,y:e.market.y+1};if(!near(p.position,counter)){if(!p.pathfinding)movePlayer(game,now,p,counter);}p.activity={description:'Tending the market stall',until:now+1000};return true;}
    return false;
  }
  if(!job)return false;
  if(g.time-job.requested>180000){e.jobs=e.jobs.filter(j=>j!==job);if(job.kind==='fish')e.nextFish=g.time+30000;return false;}
  if(job.kind==='trade'&&owner===g.owner&&bag.items.turnips<2&&bag.items.fish<2&&g.food>=2){
    const doorstep={x:g.home.x+1,y:g.home.y+3};
    if(!near(p.position,doorstep)){if(!p.pathfinding)movePlayer(game,now,p,doorstep);p.activity={description:'Collecting turnips from home',until:now+1000};return true;}
    g.food-=2;bag.items.turnips+=2;log(e,now,[owner],'collect','Bob collected two turnips from home into his bag.');
    return true;
  }
  const target=job.kind==='fish'?e.bank:job.kind==='deposit'?{x:g.home.x+1,y:g.home.y+3}:{x:e.market.x+1,y:e.market.y+3};
  const label=job.kind==='fish'?'Fishing at the river':job.kind==='deposit'?'Bringing seeds home':'Visiting Stella’s market';
  if(!near(p.position,target)){if(!p.pathfinding)movePlayer(game,now,p,target);p.activity={description:label,until:now+1000};return true;}
  stopPlayer(p);
  if(job.kind==='deposit'){const quantity=bag.items.seeds;g.seeds+=quantity;bag.items.seeds=0;log(e,now,[owner],'deposit',`Bob stored ${quantity} seed packets at home.`);finish();return true;}
  if(job.kind==='trade'){
    if(game.world.livelihood){finish();return false;} // Legacy fixed-price jobs are retired.
    const merchant=game.world.players.get(e.merchant as any);if(!merchant||!near(merchant.position,{x:e.market.x+1,y:e.market.y+1})){p.activity={description:'Waiting for Stella at the market',until:now+1000};return true;}
    const item=bag.items.turnips>=2?'turnips':'fish';
    if(barter(e,owner,item,2))log(e,now,[owner,e.merchant],'trade',`${game.playerDescriptions.get(owner as any)?.name??'A neighbor'} traded two ${item} with Stella for ${item==='turnips'?'two seed packets':'one seed packet'}.`);
    finish();return true;
  }
  if(job.started===undefined)job.started=g.time;
  p.activity={description:'Fishing at the river',until:now+1000};
  if(g.time-job.started<12000)return true;
  const caught=catchFish(e,owner);if(caught&&game.world.livelihood)game.world.livelihood.produced.fish++;log(e,now,[owner],'fish',caught?'Lucky caught a river fish and put it in his bag.':'Lucky fished at the river, but did not catch anything.');e.nextFish=g.time+25000;finish();return true;
  function finish(){e!.jobs=e!.jobs.filter(j=>j!==job);}
}
function log(e:Economy,at:number,witnesses:string[],kind:string,text:string){e.events.push({id:e.nextEvent++,at,witnesses,kind,text});e.events=e.events.slice(-30);}
