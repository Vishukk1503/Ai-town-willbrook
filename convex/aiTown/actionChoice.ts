import {priorityActions,emergencyNeed} from './physicalPriority';
import {blocksContact} from './socialBoundary';
import {restedness,demandingAction} from '../../data/restedness';
import {canRest} from './sleepState';
import {WORLD_HOUR_MS,worldTime} from '../../data/worldTime';
import {validatePlan,ProposedPlan} from './learnedPlans';
import type {Awareness} from './awareness';
import {Infer,v} from 'convex/values';
import type {Economy} from './economyState';
import type {Garden} from './gardenState';
import type {Village} from './villageState';
import {socialProfiles} from '../../data/socialProfiles';
import type {Livelihood} from './livelihoodState';
import {lifeActions,LifeOption} from './livelihoodActions';

export const actionKind=v.union(v.literal('casual'),v.literal('sleep'),v.literal('quiet'),v.literal('joint'),v.literal('activityOffer'),v.literal('activityResponse'),v.literal('walk'),v.literal('continue'),v.literal('rest'),v.literal('wander'),v.literal('talk'),v.literal('visit'),v.literal('place'),v.literal('fish'),v.literal('garden'),v.literal('trade'),v.literal('deposit'),v.literal('market'),v.literal('eat'),v.literal('cook'),v.literal('collect'),v.literal('forage'),v.literal('offer'),v.literal('respond'));
export type ActionKind=Infer<typeof actionKind>;
export const residentDecision=v.object({auditKey:v.optional(v.string()),auditEnded:v.optional(v.boolean()),needsAtChoice:v.optional(v.object({hunger:v.number(),energy:v.number(),restedness:v.optional(v.number())})),kind:actionKind,actionId:v.optional(v.string()),destination:v.optional(v.object({x:v.number(),y:v.number()})),target:v.optional(v.string()),label:v.string(),reason:v.string(),source:v.union(v.literal('model'),v.literal('fallback')),chosenAt:v.number(),until:v.number()});
export type ResidentDecision=Infer<typeof residentDecision>;
export type Option={id:string;kind:ActionKind;target?:string;label:string;score:number;destination?:{x:number;y:number}};
type Actor={id:string;position:{x:number;y:number};pathfinding?:unknown};
export type DecisionWorld={players:Actor[];conversations:{participants:{playerId:string}[]}[];garden?:Garden;economy?:Economy;village?:Village;livelihood?:Livelihood;clock?:{elapsedMs:number};agents?:{playerId:string;sleep?:{phase:string}}[];lastWakeClock?:number;awareness?:Awareness;currentDecision?:ResidentDecision};

export function availableActions(w:DecisionWorld,owner:string,now:number,lastInvite=0,lastConversation=0,name=''):LifeOption[]{
  const player=w.players.find(p=>p.id===owner);
  if(!player||w.conversations.some(c=>c.participants.some(p=>p.playerId===owner)))return [];
  const traits=socialProfiles[name]?.traits;
  const needs=w.livelihood?.needs.find(n=>n.owner===owner);
  const options:LifeOption[]=[{id:'wander',kind:'wander',label:'Walk around the village',score:20+(traits?.curiosity??50)/5}];
  if(canRest(needs?.energy))options.push({id:'rest',kind:'rest',label:'Take a short recovery break',score:needs!.energy<30?140:35});
  const home=w.village?.places.find(p=>p.kind==='home'&&p.owner===owner),hour=worldTime(w.clock?.elapsedMs??0).hour;
  const clock=w.clock?.elapsedMs??0;
  const promised=w.livelihood?.offers.some(o=>['accepted','cooking'].includes(o.status)&&o.participants.includes(owner))||w.livelihood?.activities?.some(s=>['scheduled','gathering','active'].includes(s.status)&&s.participants.includes(owner));
  if(home&&needs&&!promised&&(restedness(needs)<15||w.lastWakeClock===undefined||clock-w.lastWakeClock>=6*WORLD_HOUR_MS)&&((restedness(needs)<85&&(hour>=20||hour<6))||restedness(needs)<30||needs.energy<25))options.push({id:'sleep',kind:'sleep',label:'Go home and sleep',destination:home.entrance,score:restedness(needs)<15?220:restedness(needs)<30?150:85});
  const executing=player.pathfinding||w.economy?.jobs.some(j=>j.owner===owner)||w.livelihood?.jobs.some(j=>j.owner===owner)||w.garden?.owner===owner&&w.garden.job||w.village?.visits.some(v=>v.owner===owner)||['rest','market'].includes(w.currentDecision?.kind??'');
  if(executing&&w.currentDecision&&now<w.currentDecision.until&&w.currentDecision.kind!=='continue'&&(w.currentDecision.kind!=='rest'||canRest(needs?.energy)))options.push({id:'continue',kind:'continue',label:`Continue: ${w.currentDecision.label}`,score:65});
  const e=w.economy,g=w.garden,bag=e?.bags.find(b=>b.owner===owner)?.items;
  for(const place of w.village?.places??[]){
    if(place.kind==='home'&&place.owner!==owner)continue;
    options.push({id:`place:${place.id}`,kind:'place',target:place.id,label:place.kind==='home'?`Visit ${place.name}`:`Visit ${place.name} courtyard`,score:place.kind==='home'?30:30+(traits?.sociability??50)/5});
  }
  if(e&&g&&bag){
    if(e.fisher===owner&&bag.rod>0&&bag.fish<4&&e.population>0&&g.time>=e.nextFish)options.push({id:'fish',kind:'fish',label:'Go fishing at the river',score:55});
    if(g.owner===owner){
      if(bag.seeds>0)options.push({id:'deposit',kind:'deposit',label:'Bring carried seeds home',score:70});
      if((!w.livelihood||g.food+bag.turnips<8)&&g.time>=g.nextJob&&g.beds.some(b=>b.state==='ready'||b.state==='empty'&&g.seeds>0))options.push({id:'garden',kind:'garden',label:g.beds.some(b=>b.state==='ready')?'Harvest a ripe garden bed':'Plant a garden bed',score:55+(traits?.routine??50)/5});
    }
    if(!w.livelihood&&owner!==e.merchant&&((bag.turnips>=2||g.owner===owner&&g.food>=2)&&e.marketStock.seeds>=2||bag.fish>=2&&e.marketStock.seeds>=1))options.push({id:'trade',kind:'trade',label:'Take produce to the market for seeds',score:60});
    if(owner===e.merchant)options.push({id:'market',kind:'market',label:e.jobs.some(j=>j.kind==='trade')?'Serve a waiting customer at the market':'Tend the market stall',score:e.jobs.some(j=>j.kind==='trade')?90:40});
  }
  if(e)options.push({id:'walk:river',kind:'walk',label:'Walk to the river bank',destination:e.bank,score:25+(traits?.curiosity??50)/5});
  if(g)options.push({id:'walk:garden',kind:'walk',label:'Walk to the garden edge',destination:{x:g.origin.x+6,y:g.origin.y+6},score:25});
  const physicallyBusy=(id:string)=>!!w.players.find(p=>p.id===id)?.pathfinding||!!w.economy?.jobs.some(j=>j.owner===id)||!!w.livelihood?.jobs.some(j=>j.owner===id)||w.garden?.owner===id&&!!w.garden.job;
  for(const other of w.players){
    if(other.id===owner||blocksContact(w.awareness?.boundaries,other.id,clock))continue;
    const seen=!w.awareness||w.awareness.visible.includes(other.id);
    const busy=w.conversations.some(c=>c.participants.some(p=>p.playerId===other.id));
    if(seen&&busy)continue;
    const known=w.awareness?.lastSeen.find(s=>s.id===other.id)?.position??w.village?.places.find(p=>p.owner===other.id)?.entrance;
    if(w.awareness&&!known)continue;
    options.push({id:`visit:${other.id}`,kind:'visit',target:other.id,label:`Look for ${other.id} at their last known place`,destination:known,score:15+(traits?.sociability??50)/5});
    if(seen&&!busy&&!w.agents?.some(a=>a.playerId===other.id&&a.sleep)&&now-lastInvite>=60000&&now-lastConversation>=60000)options.push({id:'casual:'+other.id,kind:'casual',target:other.id,label:'Briefly greet '+other.id+' while continuing what you are doing',score:38+(traits?.sociability??50)/4});
    if(!physicallyBusy(owner)&&!physicallyBusy(other.id)&&!w.agents?.some(a=>a.playerId===other.id&&a.sleep)&&(!w.awareness||w.awareness.visible.includes(other.id))&&now-lastInvite>=30000&&now-lastConversation>=30000)options.push({id:`talk:${other.id}`,kind:'talk',target:other.id,label:`Ask ${other.id} for a conversation`,score:20+(traits?.sociability??50)/3});
  }
  options.push(...lifeActions(w,owner).filter(o=>(!o.target||!blocksContact(w.awareness?.boundaries,o.target,clock,o.activityProposal?.activity))&&!(o.proposal?.participants??[]).some(id=>id!==owner&&blocksContact(w.awareness?.boundaries,id,clock))));
  for(const option of options){
    if(needs&&(needs.energy<30||restedness(needs)<30)&&demandingAction(option.kind))option.score-=60;
    if(w.awareness&&['talk','visit'].includes(option.kind))option.score+=Math.min(35,Math.max(0,((w.livelihood?.clock??0)-(w.awareness.lastCompanyClock??w.livelihood?.clock??0)-180000)/60000)*5)+Math.round((w.awareness.socialReadiness-50)/5-w.awareness.stress/10);
  }
  if(emergencyNeed(needs))return priorityActions(options,needs);
  if(needs&&restedness(needs)<15){const safe=options.filter(o=>!demandingAction(o.kind)&&o.kind!=='continue');if(restedness(needs)<=0&&safe.some(o=>o.kind==='sleep')&&needs.hunger<90)return safe.filter(o=>o.kind==='sleep');return safe;}
  const shared=w.livelihood?.activities?.find(s=>s.participants.includes(owner)&&['scheduled','gathering','active'].includes(s.status));
  if(shared){options.push({id:'continue',kind:'continue',label:'Continue the agreed activity',score:65});return options.filter(o=>o.kind==='casual'&&shared.participants.includes(o.target??'')||o.kind==='continue'||o.kind==='quiet'||o.kind==='activityResponse'&&o.activityId===shared.id);}
  return options;
}

export function parseAction(text:string,options:Option[]):{option:Option;reason:string;plan?:ProposedPlan;abandonPlan?:boolean;planIssue?:string}{
  const parsed=JSON.parse(text.trim());
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).some(k=>!['action','reason','plan','abandonPlan'].includes(k)))throw new Error('Invalid action response.');
  if(parsed.abandonPlan!==undefined&&typeof parsed.abandonPlan!=='boolean')throw new Error('Invalid plan control.');
  if(parsed.abandonPlan&&parsed.plan)throw new Error('Cannot abandon and replace a plan together.');
  const option=options.find(o=>o.id===parsed.action);
  if(!option||typeof parsed.reason!=='string'||!parsed.reason.trim()||parsed.reason.length>160)throw new Error('Action is not available.');
  let plan:ProposedPlan|undefined,planIssue:string|undefined;
  try{plan=validatePlan(parsed.plan??undefined,parsed.action,options.map(o=>o.id));}catch{planIssue='Invalid optional plan discarded; existing plan retained.';}
  return {option,reason:parsed.reason.trim(),...(parsed.abandonPlan?{abandonPlan:true}:{}),plan,...(planIssue?{planIssue}:{})};
}

export function fallbackAction(options:Option[],previous?:ActionKind):Option|undefined{
  return options.slice().sort((a,b)=>(b.score-(b.kind===previous?20:0))-(a.score-(a.kind===previous?20:0)))[0];
}
