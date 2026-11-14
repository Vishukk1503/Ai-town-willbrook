import {AWAKE_RESTEDNESS_DRAIN,SLEEP_RESTEDNESS_GAIN} from '../../data/restedness';
import {WORLD_HOUR_MS} from '../../data/worldTime';
import {socialActivity} from './socialActivityTypes';
import {Infer,v} from 'convex/values';
import type {Economy} from './economyState';

export const foodKind=v.union(v.literal('turnips'),v.literal('fish'),v.literal('meals'));
export type Food=Infer<typeof foodKind>;
const commitment=v.object({owner:v.string(),item:foodKind,quantity:v.number()});
const recipeId=v.union(v.literal('vegetable'),v.literal('fish'),v.literal('mixed'));
export type RecipeId=Infer<typeof recipeId>;
export const RECIPES={
  vegetable:{turnips:2,fish:0,meals:2,label:'vegetable soup'},
  fish:{turnips:0,fish:1,meals:2,label:'fish supper'},
  mixed:{turnips:2,fish:1,meals:3,label:'fish and vegetable stew'},
} as const;
export const agreement=v.object({
  id:v.number(),thread:v.number(),kind:v.union(v.literal('barter'),v.literal('gift'),v.literal('cook')),
  proposer:v.string(),participants:v.array(v.string()),acceptedBy:v.array(v.string()),
  inputs:v.array(commitment),outputs:v.array(commitment),escrow:v.array(commitment),
  recipe:v.optional(recipeId),cook:v.optional(v.string()),
  status:v.union(v.literal('open'),v.literal('accepted'),v.literal('cooking'),v.literal('completed'),v.literal('declined'),v.literal('countered'),v.literal('expired')),
  counters:v.number(),created:v.number(),expires:v.number(),started:v.optional(v.number()),
});
export type Agreement=Infer<typeof agreement>;
export const livelihoodState=v.object({
  version:v.literal(1),clock:v.number(),activities:v.optional(v.array(socialActivity)),nextActivity:v.optional(v.number()),
  needs:v.array(v.object({owner:v.string(),hunger:v.number(),energy:v.number(),restedness:v.optional(v.number()),lastFood:v.optional(foodKind),variety:v.number(),lastForage:v.number()})),
  jobs:v.array(v.object({owner:v.string(),kind:v.union(v.literal('eat'),v.literal('cook'),v.literal('collect'),v.literal('forage')),item:v.optional(foodKind),recipe:v.optional(recipeId),started:v.optional(v.number()),requested:v.number()})),
  offers:v.array(agreement),nextOffer:v.number(),
  events:v.array(v.object({id:v.number(),at:v.number(),kind:v.string(),text:v.string(),witnesses:v.array(v.string())})),nextEvent:v.number(),
  produced:v.object({turnips:v.number(),fish:v.number(),meals:v.number()}),consumed:v.object({turnips:v.number(),fish:v.number(),meals:v.number()}),
});
export type Livelihood=Infer<typeof livelihoodState>;
export type Need=Livelihood['needs'][number];
export const foodCount=(e:Economy,owner:string,item:Food)=>e.bags.find(b=>b.owner===owner)?.items[item]??0;
export function addFood(e:Economy,owner:string,item:Food,delta:number){const b=e.bags.find(b=>b.owner===owner);if(!b)throw new Error('Missing owner.');b.items[item]=(b.items[item]??0)+delta;}
export function livelihood(owners:string[],clock:number):Livelihood{return {version:1,clock,needs:owners.map(owner=>({owner,hunger:30,energy:80,restedness:85,variety:40,lastForage:clock-180000})),jobs:[],offers:[],nextOffer:0,events:[],nextEvent:0,produced:{turnips:0,fish:0,meals:0},consumed:{turnips:0,fish:0,meals:0}};}
export function lifeEvent(l:Livelihood,at:number,kind:string,text:string,witnesses:string[]){l.events.push({id:l.nextEvent++,at,kind,text,witnesses:[...new Set(witnesses)]});l.events=l.events.slice(-60);}
const bounded=(n:number)=>Math.max(0,Math.min(100,n));
export type NeedActivity='work'|'lightWork'|'walk'|'rest'|'sleep'|'idle';
export const NEED_RATES:Record<NeedActivity,{hunger:number;energy:number}>={
  idle:{hunger:6,energy:-4},walk:{hunger:6,energy:-5},
  lightWork:{hunger:6,energy:-6},work:{hunger:6,energy:-8},
  rest:{hunger:6,energy:20},sleep:{hunger:2,energy:10},
};
export function advanceNeeds(l:Livelihood,clock:number,activity:(owner:string)=>NeedActivity){
  const dt=Math.max(0,Math.min(1000,clock-l.clock));l.clock=clock;
  for(const n of l.needs){
    const currentActivity=activity(n.owner),rate=NEED_RATES[currentActivity];
    n.restedness=bounded((n.restedness??65)+dt*(currentActivity==='sleep'?SLEEP_RESTEDNESS_GAIN:currentActivity==='rest'?-2:-AWAKE_RESTEDNESS_DRAIN)/WORLD_HOUR_MS);
    n.hunger=bounded(n.hunger+dt*rate.hunger/WORLD_HOUR_MS);
    n.energy=bounded(n.energy+dt*rate.energy/WORLD_HOUR_MS);
  }
}
export function eat(l:Livelihood,e:Economy,owner:string,item:Food,at:number){
  const n=l.needs.find(n=>n.owner===owner);
  if(!n||item==='fish'||n.hunger<(item==='meals'?35:15)||foodCount(e,owner,item)<1)return false;
  addFood(e,owner,item,-1);l.consumed[item]++;n.hunger=bounded(n.hunger-(item==='meals'?38:18));
  n.energy=bounded(n.energy+(item==='meals'?3:1));n.variety=bounded(n.variety+(n.lastFood&&n.lastFood!==item?12:-3));n.lastFood=item;
  lifeEvent(l,at,'eat',`Ate one ${item==='meals'?'prepared meal':'turnip'}.`,[owner]);return true;
}

export function validTerms(e:Economy,a:Pick<Agreement,'kind'|'participants'|'inputs'|'outputs'|'recipe'|'cook'|'proposer'>){
  const members=[...new Set(a.participants)];
  if(members.length!==a.participants.length||members.length<2||members.length>3||!members.includes(a.proposer)||members.some(o=>!e.bags.some(b=>b.owner===o)))return false;
  const goods=[...a.inputs,...a.outputs];
  if(goods.length>10||goods.some(g=>!members.includes(g.owner)||!['turnips','fish','meals'].includes(g.item)||!Number.isSafeInteger(g.quantity)||g.quantity<1||g.quantity>8))return false;
  if(a.inputs.some((g,i)=>a.inputs.some((p,j)=>j<i&&p.owner===g.owner&&p.item===g.item)))return false;
  const sum=(list:Agreement['inputs'],item:Food)=>list.filter(g=>g.item===item).reduce((n,g)=>n+g.quantity,0);
  if(a.kind==='cook'){
    const r=a.recipe&&RECIPES[a.recipe];
    return !!r&&a.cook===e.merchant&&members.includes(a.cook)&&sum(a.inputs,'turnips')===r.turnips&&sum(a.inputs,'fish')===r.fish&&sum(a.inputs,'meals')===0&&sum(a.outputs,'meals')===r.meals&&sum(a.outputs,'fish')===0&&sum(a.outputs,'turnips')===0&&members.every(o=>a.outputs.some(g=>g.owner===o));
  }
  if(a.recipe||a.cook)return false;
  if(!a.inputs.length||!a.outputs.length||(['turnips','fish','meals'] as Food[]).some(item=>sum(a.inputs,item)!==sum(a.outputs,item)))return false;
  // Every input is delivered to another party, never back to its owner as a fake trade.
  if(a.inputs.some(g=>a.outputs.some(o=>o.owner===g.owner&&o.item===g.item)))return false;
  return a.kind==='gift'?a.inputs.every(g=>g.owner===a.proposer):members.every(o=>a.inputs.some(g=>g.owner===o)&&a.outputs.some(g=>g.owner===o));
}
export function createOffer(l:Livelihood,e:Economy,terms:Pick<Agreement,'kind'|'participants'|'inputs'|'outputs'|'recipe'|'cook'|'proposer'>,at:number,thread?:number,counters=0){
  if(!validTerms(e,terms)||counters>2)return null;
  if(l.offers.some(o=>o.proposer===terms.proposer&&['open','accepted','cooking'].includes(o.status)&&o.participants.some(p=>terms.participants.includes(p)&&p!==terms.proposer)))return null;
  // Only the proposer must own their offered goods now. Others' private stock is not assumed known.
  if(terms.inputs.filter(g=>g.owner===terms.proposer).some(g=>foodCount(e,g.owner,g.item)<g.quantity))return null;
  const id=l.nextOffer++;
  const offer:Agreement={...terms,id,thread:thread??id,counters,acceptedBy:[terms.proposer],escrow:[],status:'open',created:l.clock,expires:l.clock+240000};
  l.offers.push(offer);l.offers=l.offers.filter(o=>['open','accepted','cooking'].includes(o.status)).concat(l.offers.filter(o=>!['open','accepted','cooking'].includes(o.status)).slice(-20)).sort((a,b)=>a.id-b.id);
  lifeEvent(l,at,'offer',`${terms.kind==='cook'?'Proposed a cooking agreement':terms.kind==='gift'?'Offered a gift':'Proposed a barter'}; agreement #${id}.`,terms.participants);return offer;
}
export function releaseOffer(l:Livelihood,e:Economy,o:Agreement,at:number,status:'expired'|'declined'){
  for(const g of o.escrow)addFood(e,g.owner,g.item,g.quantity);o.escrow=[];o.status=status;
  lifeEvent(l,at,status,`Agreement #${o.id} ${status}; any reserved goods were returned.`,o.participants);
}
export function respondOffer(l:Livelihood,e:Economy,id:number,owner:string,response:'accept'|'decline'|'counter',at:number){
  const o=l.offers.find(o=>o.id===id);
  if(!o||o.status!=='open'||!o.participants.includes(owner)||o.acceptedBy.includes(owner)||l.clock>=o.expires)return false;
  if(response==='decline'){releaseOffer(l,e,o,at,'declined');return true;}
  if(response==='counter'){
    if(o.kind!=='barter'||o.counters>=2||o.participants.length!==2)return false;
    const input=o.inputs.find(g=>g.owner===owner);if(!input)return false;
    const inputs=o.inputs.map(g=>({...g,quantity:g.owner===owner?Math.max(1,g.quantity-1):Math.min(8,g.quantity+1)}));
    const outputs=inputs.map(g=>({...g,owner:o.participants.find(p=>p!==g.owner)!}));
    o.status='countered';
    if(!createOffer(l,e,{kind:'barter',proposer:owner,participants:o.participants,inputs,outputs},at,o.thread,o.counters+1)){o.status='open';return false;}
    return true;
  }
  if(o.inputs.filter(g=>g.owner===owner).some(g=>foodCount(e,owner,g.item)<g.quantity))return false;
  const all=[...o.acceptedBy,owner];
  if(all.length===o.participants.length){
    // Reserve both sides atomically only after every participant consents.
    if(o.inputs.some(g=>foodCount(e,g.owner,g.item)<g.quantity))return false;
    if(l.offers.some(p=>p!==o&&['accepted','cooking'].includes(p.status)&&p.participants.some(x=>o.participants.includes(x))))return false;
    for(const g of o.inputs)addFood(e,g.owner,g.item,-g.quantity);
    o.escrow=o.inputs.map(g=>({...g}));o.status='accepted';o.expires=l.clock+240000;
    lifeEvent(l,at,'accepted',`Everyone accepted agreement #${o.id}; goods are reserved until the meeting.`,o.participants);
  }
  o.acceptedBy=all;return true;
}
export function settleOffers(l:Livelihood,e:Economy,at:number,present:(owner:string,kind:Agreement['kind'])=>boolean){
  for(const o of l.offers){
    if(!['open','accepted','cooking'].includes(o.status))continue;
    if(l.clock>=o.expires){releaseOffer(l,e,o,at,'expired');continue;}
    if(o.status==='open')continue;
    if(!o.participants.every(p=>present(p,o.kind))){if(o.status==='cooking'){o.status='accepted';delete o.started;}continue;}
    if(o.kind==='cook'){
      if(o.started===undefined){o.started=l.clock;o.status='cooking';}
      if(l.clock-o.started<16000)continue;
      const r=RECIPES[o.recipe!];l.consumed.turnips+=r.turnips;l.consumed.fish+=r.fish;l.produced.meals+=r.meals;
    }
    for(const g of o.outputs)addFood(e,g.owner,g.item,g.quantity);
    o.escrow=[];o.status='completed';
    lifeEvent(l,at,o.kind==='cook'?'cooking_agreement':o.kind==='gift'?'gift':'barter',`Completed ${o.kind==='cook'?RECIPES[o.recipe!].label+' and shared the portions':o.kind==='gift'?'the agreed gift':'the agreed barter'} in agreement #${o.id}.`,o.participants);
  }
}
