import {sharedMotive} from './socialOpportunity';
import type {SocialActivity} from './socialActivityTypes';
import type {DecisionWorld,Option} from './actionChoice';
import {Food,Agreement,foodCount,RECIPES,RecipeId} from './livelihoodState';
export type OfferTerms=Pick<Agreement,'kind'|'participants'|'inputs'|'outputs'|'recipe'|'cook'|'proposer'>;
export type LifeOption=Option&{proposal?:OfferTerms;response?:'accept'|'decline'|'counter';offerId?:number;food?:Food;recipe?:RecipeId;activityId?:number;activityResponse?:'accept'|'decline'|'cancel';activityProposal?:{activity:SocialActivity['activity'];placeId:string;destinationId?:string;delayMinutes:number}};
export function lifeActions(w:DecisionWorld,owner:string):LifeOption[]{
  const l=w.livelihood,e=w.economy,g=w.garden,n=l?.needs.find(n=>n.owner===owner);
  if(!l||!e||!g||!n)return [];
  const options:LifeOption[]=[];
  const sessions=l.activities??[],ownSession=sessions.find(s=>s.participants.includes(owner)&&['proposed','scheduled','gathering','active'].includes(s.status));
  if(ownSession){
    if(ownSession.status==='proposed'&&!ownSession.acceptedBy.includes(owner)){
      if(ownSession.activity!=='meal'||foodCount(e,owner,'meals')>0)options.push({id:'social:accept:'+ownSession.id,kind:'activityResponse',activityId:ownSession.id,activityResponse:'accept',label:'Accept invitation #'+ownSession.id+' to '+ownSession.activity+' together',score:60});
      options.push({id:'social:decline:'+ownSession.id,kind:'activityResponse',activityId:ownSession.id,activityResponse:'decline',label:'Decline invitation #'+ownSession.id,score:25});
    }else options.push({id:'social:cancel:'+ownSession.id,kind:'activityResponse',activityId:ownSession.id,activityResponse:'cancel',label:'Cancel your shared '+ownSession.activity+' plan',score:5});
    if(ownSession.status==='active')options.push({id:'quiet',kind:'quiet',label:'Keep company quietly',score:35});
  }
  if(!ownSession)for(const other of w.players.filter(p=>p.id!==owner&&w.awareness?.visible.includes(p.id))){
    const place=w.village?.places.find(p=>p.kind==='tavern')?.id??'garden';
    if(foodCount(e,owner,'meals')>0&&sharedMotive(w,owner,other.id,'meal'))options.push({id:'together:meal:'+other.id,kind:'activityOffer',target:other.id,label:'Invite '+other.id+' to eat your own prepared portions together',score:18,activityProposal:{activity:'meal',placeId:place,delayMinutes:0}});
    if(sharedMotive(w,owner,other.id,'walk'))options.push({id:'together:walk:'+other.id,kind:'activityOffer',target:other.id,label:'Invite '+other.id+' for a walk to the river',score:25,activityProposal:{activity:'walk',placeId:place,destinationId:'river',delayMinutes:0}});
    if(sharedMotive(w,owner,other.id,'visit'))options.push({id:'together:visit:'+other.id,kind:'activityOffer',target:other.id,label:'Invite '+other.id+' to spend a quiet visit together',score:25,activityProposal:{activity:'visit',placeId:place,delayMinutes:0}});
    if(sharedMotive(w,owner,other.id,'help')&&[owner,other.id].includes(g.owner)&&g.beds.some(b=>b.state==='ready'||b.state==='empty'&&g.seeds>0))options.push({id:'together:help:'+other.id,kind:'activityOffer',target:other.id,label:'Suggest helping with one garden task together',score:30,activityProposal:{activity:'help',placeId:'garden',delayMinutes:0}});
  }
  const own=(item:Food)=>foodCount(e,owner,item);
  const food=(item:Food)=>item==='turnips'?'turnips':item==='fish'?'fish':'meals';
  if(n.hunger>=15)for(const item of ['meals','turnips'] as Food[])if(own(item)>0&&n.hunger>=(item==='meals'?35:15))options.push({id:`eat:${item}`,kind:'eat',food:item,label:`Eat one ${item==='meals'?'prepared meal':'turnip'}`,score:35+n.hunger+(item==='meals'?10:0)});
  if(owner===g.owner&&g.food>0)options.push({id:'collect-food',kind:'collect',label:'Bring harvested turnips into your bag',score:n.hunger>55?100:50});
  if(l.clock-n.lastForage>=180000)options.push({id:'forage',kind:'forage',label:'Gather wild roots near the garden',score:n.hunger>75&&own('turnips')+own('meals')===0?130:12});
  for(const recipe of Object.keys(RECIPES) as RecipeId[]){const r=RECIPES[recipe];if(own('turnips')>=r.turnips&&own('fish')>=r.fish&&own('meals')<(owner===e.merchant?6:3))options.push({id:`cook:${recipe}`,kind:'cook',recipe,label:`${owner===e.merchant?'Cook':'Prepare a simple'} ${r.label} (${owner===e.merchant?r.meals:Math.max(1,r.meals-1)} portions)`,score:owner===e.merchant?65:own('meals')===0&&n.hunger>40?90:25});}
  for(const offer of l.offers.filter(o=>o.status==='open'&&o.participants.includes(owner)&&!o.acceptedBy.includes(owner)&&o.expires>l.clock)){
    const canAfford=offer.inputs.filter(g=>g.owner===owner).every(g=>own(g.item)>=g.quantity);
    if(canAfford)options.push({id:`accept:${offer.id}`,kind:'respond',offerId:offer.id,response:'accept',label:`Accept agreement #${offer.id}`,score:75});
    options.push({id:`decline:${offer.id}`,kind:'respond',offerId:offer.id,response:'decline',label:`Decline agreement #${offer.id}`,score:canAfford?15:70});
    if(offer.kind==='barter'&&offer.counters<2)options.push({id:`counter:${offer.id}`,kind:'respond',offerId:offer.id,response:'counter',label:`Counter agreement #${offer.id}: request more for your goods`,score:40});
  }
  if(l.offers.some(o=>o.proposer===owner&&['open','accepted','cooking'].includes(o.status)))return options;
  const partners=e.bags.filter(b=>b.owner!==owner);
  // Quantities are possible proposed terms, never an imposed exchange rate.
  for(const other of partners){
    const otherSpecialty:Food=other.owner===e.merchant?'meals':other.owner===e.fisher?'fish':'turnips';
    const ownSpecialty:Food=owner===e.merchant?'meals':owner===e.fisher?'fish':'turnips';
    const give=own(ownSpecialty)>1?ownSpecialty:(['turnips','fish','meals'] as Food[]).find(item=>item!==otherSpecialty&&own(item)>1);
    if(!give||give===otherSpecialty||own(otherSpecialty)>=4)continue;
    for(const [giveN,wantN] of [[1,1],[2,1],[1,2]]){
      if(own(give)<giveN)continue;
      const inputs=[{owner,item:give,quantity:giveN},{owner:other.owner,item:otherSpecialty,quantity:wantN}];
      options.push({id:`offer:${other.owner}:${give}:${giveN}:${otherSpecialty}:${wantN}`,kind:'offer',target:other.owner,label:`Offer ${giveN} ${food(give)} for ${wantN} ${food(otherSpecialty)} from ${other.owner}`,score:n.hunger>55&&otherSpecialty==='meals'?80:38,proposal:{kind:'barter',proposer:owner,participants:[owner,other.owner],inputs,outputs:inputs.map(g=>({...g,owner:g.owner===owner?other.owner:owner}))}});
    }
    if(n.hunger<65&&own(give)>=2)options.push({id:`gift:${other.owner}:${give}`,kind:'offer',target:other.owner,label:`Offer one ${give} as a gift to ${other.owner}`,score:15,proposal:{kind:'gift',proposer:owner,participants:[owner,other.owner],inputs:[{owner,item:give,quantity:1}],outputs:[{owner:other.owner,item:give,quantity:1}]}});
  }
  // A three-way commission needs no initial meal stock or money. Each party explicitly consents.
  const farmer=g.owner,fisher=e.fisher,cook=e.merchant;
  if(new Set([farmer,fisher,cook]).size===3&&e.bags.some(b=>b.owner===farmer)){
    const inputs=[{owner:farmer,item:'turnips' as Food,quantity:2},{owner:fisher,item:'fish' as Food,quantity:1}];
    if(inputs.filter(g=>g.owner===owner).every(g=>own(g.item)>=g.quantity))options.push({id:'shared-stew',kind:'offer',label:'Propose a shared stew: farmer brings 2 turnips, fisher 1 fish, cook prepares it; one bowl each',score:owner===cook?70:45,proposal:{kind:'cook',proposer:owner,participants:[farmer,fisher,cook],cook,recipe:'mixed',inputs,outputs:[farmer,fisher,cook].map(owner=>({owner,item:'meals',quantity:1}))}});
  }
  // Bilateral cooking commissions also work when the third resident is unavailable.
  if(owner!==e.merchant)for(const recipe of ['vegetable','fish'] as RecipeId[]){
    const r=RECIPES[recipe];if(own('turnips')<r.turnips||own('fish')<r.fish)continue;
    const inputs:Agreement['inputs']=[];if(r.turnips)inputs.push({owner,item:'turnips',quantity:r.turnips});if(r.fish)inputs.push({owner,item:'fish',quantity:r.fish});
    options.push({id:`commission:${recipe}`,kind:'offer',target:e.merchant,label:`Ask ${e.merchant} to cook your ${recipe==='fish'?'fish':'vegetables'}; one portion each`,score:55,proposal:{kind:'cook',proposer:owner,participants:[owner,e.merchant],inputs,outputs:[{owner,item:'meals',quantity:1},{owner:e.merchant,item:'meals',quantity:1}],cook:e.merchant,recipe}});
  }
  return options;
}
