import type {Game} from './game';
import {movePlayer,stopPlayer} from './movement';
import {parseGameId} from './ids';
import {advanceNeeds,settleOffers,eat,foodCount,addFood,lifeEvent,RECIPES} from './livelihoodState';

export function meetingPoint(game:Game,kind:string){
  return kind==='cook'?(game.world.village?.places.find(p=>p.kind==='tavern')?.entrance??{x:game.world.economy!.market.x+1,y:game.world.economy!.market.y+3}):{x:game.world.economy!.market.x+1,y:game.world.economy!.market.y+3};
}
export function tickLivelihood(game:Game,now:number){
  const l=game.world.livelihood,e=game.world.economy,g=game.world.garden;if(!l||!e||!g)return;
  advanceNeeds(l,g.time,owner=>{
    const agent=[...game.world.agents.values()].find(a=>a.playerId===owner),p=game.world.players.get(parseGameId('players',owner));
    if(agent?.sleep?.phase==='asleep')return 'sleep';
    if(p?.pathfinding)return 'walk';
    if(p&&agent?.decision?.kind==='rest'&&agent.decision.until>now&&!game.world.playerConversation(p))return 'rest';
    if(p?.pathfinding)return 'walk';
    if(l.activities?.some(s=>s.activity==='help'&&s.status==='active'&&s.participants.includes(owner)))return 'work';
    if(g.owner===owner&&g.job||l.jobs.some(j=>j.owner===owner&&j.kind==='forage'))return 'work';
    if(l.jobs.some(j=>j.owner===owner&&j.kind==='cook')||e.jobs.some(j=>j.owner===owner))return 'lightWork';
    return 'idle';
  });
  settleOffers(l,e,now,(owner,kind)=>{
    const p=game.world.players.get(parseGameId('players',owner)),target=meetingPoint(game,kind);
    return !!p&&(!game.world.playerConversation(p)||!!game.world.playerConversation(p)?.casual)&&Math.hypot(p.position.x-target.x,p.position.y-target.y)<2.3;
  });
}

export function livelihoodWork(game:Game,owner:string,now:number):boolean{
  const l=game.world.livelihood,e=game.world.economy,g=game.world.garden,p=game.world.players.get(parseGameId('players',owner));
  if(!l||!e||!g||!p)return false;
  const contract=l.offers.find(o=>['accepted','cooking'].includes(o.status)&&o.participants.includes(owner));
  const physical=l.needs.find(n=>n.owner===owner);
  if(contract&&!(physical&&(physical.hunger>=90||physical.energy<15))){
    const target=meetingPoint(game,contract.kind);
    if(Math.hypot(p.position.x-target.x,p.position.y-target.y)>1.5){if(!p.pathfinding)movePlayer(game,now,p,target);p.activity={description:contract.kind==='cook'?'Bringing ingredients to the tavern':'Meeting for an agreed exchange',until:now+1000};}
    else {stopPlayer(p);p.activity={description:contract.status==='cooking'?'Sharing the cooking work':'Waiting for an agreed exchange',until:now+1000};}
    return true;
  }
  const job=l.jobs.find(j=>j.owner===owner);if(!job)return false;
  const end=()=>{l.jobs=l.jobs.filter(j=>j!==job);};
  if(l.clock-job.requested>120000){end();return false;}
  const ownHome=game.world.village?.places.find(p=>p.kind==='home'&&p.owner===owner)?.entrance??{x:g.home.x+1,y:g.home.y+3};
  const target=job.kind==='cook'?(owner===e.merchant?meetingPoint(game,'cook'):ownHome):job.kind==='collect'?{x:g.home.x+1,y:g.home.y+3}:job.kind==='forage'?{x:g.origin.x+6,y:g.origin.y+6}:p.position;
  if(Math.hypot(p.position.x-target.x,p.position.y-target.y)>1.1){if(!p.pathfinding)movePlayer(game,now,p,target);p.activity={description:job.kind==='forage'?'Looking for wild turnips':job.kind==='collect'?'Collecting garden produce':'Going to prepare food',until:now+1000};return true;}
  stopPlayer(p);if(job.started===undefined)job.started=l.clock;
  const needs=l.needs.find(n=>n.owner===owner)!;
  const duration=(job.kind==='eat'?2000:job.kind==='collect'?2000:job.kind==='forage'?16000:14000)*(needs.energy<15?1.5:1);
  p.activity={description:job.kind==='eat'?'Eating a little food':job.kind==='cook'?'Preparing food at the hearth':job.kind==='forage'?'Gathering wild turnips':'Collecting garden produce',until:now+1000};
  if(l.clock-job.started<duration)return true;
  if(job.kind==='eat')eat(l,e,owner,job.item!,now);
  if(job.kind==='collect'&&owner===g.owner&&g.food>0){const q=Math.min(4,g.food);g.food-=q;addFood(e,owner,'turnips',q);lifeEvent(l,now,'collect',`Collected ${q} stored turnips from home.`,[owner]);}
  if(job.kind==='forage'&&l.clock-needs.lastForage>=180000){addFood(e,owner,'turnips',1);needs.lastForage=l.clock;l.produced.turnips++;lifeEvent(l,now,'forage','Gathered one wild turnip near the garden.',[owner]);}
  if(job.kind==='cook'&&job.recipe){
    const r=RECIPES[job.recipe];
    if(foodCount(e,owner,'turnips')>=r.turnips&&foodCount(e,owner,'fish')>=r.fish){
      const quantity=owner===e.merchant?r.meals:Math.max(1,r.meals-1);
      addFood(e,owner,'turnips',-r.turnips);addFood(e,owner,'fish',-r.fish);addFood(e,owner,'meals',quantity);
      l.consumed.turnips+=r.turnips;l.consumed.fish+=r.fish;l.produced.meals+=quantity;
      lifeEvent(l,now,'cook',`Prepared ${quantity} portions of ${r.label}.`,[owner]);
    }
  }
  end();return true;
}

export function needsContext(game:Game,owner:string){
  const l=game.world.livelihood;if(!l)return '';
  const n=l.needs.find(n=>n.owner===owner);
  return n?`Hunger ${Math.round(n.hunger)}/100 (higher means hungrier); energy ${Math.round(n.energy)}/100. Your last food was ${n.lastFood??'not recorded'}.` : '';
}
