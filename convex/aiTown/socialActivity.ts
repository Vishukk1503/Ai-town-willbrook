import {blocksContact} from './socialBoundary';
import {sharedMotive} from './socialOpportunity';
import {restedness} from '../../data/restedness';
import {WORLD_MINUTE_MS} from '../../data/worldTime';
import {SocialActivity} from './socialActivityTypes';
import type {Game} from './game';
import {parseGameId} from './ids';
import {movePlayer,stopPlayer} from './movement';
import {eat,foodCount,lifeEvent} from './livelihoodState';
import {workGarden} from './gardenState';
export const unfinished=(s:SocialActivity)=>['proposed','scheduled','gathering','active'].includes(s.status);
export function activityPlaces(game:Game){
  const e=game.world.economy,g=game.world.garden;
  return [...(game.world.village?.places??[]).map(p=>({id:p.id,name:p.name,position:p.entrance})),...(e?[{id:'river',name:'Riverbank',position:e.bank}]:[]),...(g?[{id:'garden',name:'Garden',position:{x:g.origin.x+6,y:g.origin.y+6}}]:[])];
}
// Bounded allowances for actual walking, including map detours and companion waiting.
export function travelAllowance(points:{x:number;y:number}[],target:{x:number;y:number}){
 const tiles=Math.max(0,...points.map(p=>Math.abs(p.x-target.x)+Math.abs(p.y-target.y)));
 return Math.min(240000,Math.max(60000,30000+tiles*4000));
}
function stageDeadline(game:Game,s:SocialActivity){
 const l=game.world.livelihood!,places=activityPlaces(game),target=places.find(p=>p.id===(s.status==='active'&&s.activity==='walk'?s.destinationId:s.placeId))?.position??{x:0,y:0};
 const points=s.participants.map(id=>game.world.players.get(parseGameId('players',id))?.position).filter((p):p is {x:number;y:number}=>!!p);
 if(s.status==='scheduled'||s.status==='gathering')s.expires=Math.max(l.clock,s.due)+travelAllowance(points,target);
 else if(s.status==='active')s.expires=l.clock+(s.activity==='walk'?travelAllowance(points,target)+60000:s.activity==='help'?180000:s.activity==='meal'?80000:60000);
 s.expires=Math.min(s.expires,s.hardExpires??s.created+720000);s.deadlineStage=s.status;
}
export function proposeActivity(game:Game,owner:string,partner:string,p:{activity:SocialActivity['activity'];placeId:string;destinationId?:string;delayMinutes:number},now:number){
  const l=game.world.livelihood,e=game.world.economy;if(!l||!e||owner===partner||![owner,partner].every(id=>game.world.players.has(parseGameId('players',id))))return false;
  const places=activityPlaces(game);if(!places.some(x=>x.id===p.placeId)||p.activity==='walk'&&(!p.destinationId||p.destinationId===p.placeId||!places.some(x=>x.id===p.destinationId))||p.activity==='help'&&(p.placeId!=='garden'||![owner,partner].includes(game.world.garden?.owner??''))||!Number.isFinite(p.delayMinutes)||p.delayMinutes<0||p.delayMinutes>30)return false;
  const actor=[...game.world.agents?.values()??[]].find(a=>a.playerId===owner);
  if(blocksContact(actor?.awareness?.boundaries,partner,game.world.clock?.elapsedMs??0,p.activity))return false;
  const serial={players:[...game.world.players.values()],conversations:[],livelihood:l,economy:e,garden:game.world.garden,village:game.world.village,awareness:actor?.awareness};
  if(!sharedMotive(serial,owner,partner,p.activity))return false;
  l.activities??=[];
  if(l.activities.some(s=>unfinished(s)&&s.participants.some(id=>id===owner||id===partner)))return false;
  if(p.activity==='meal'&&foodCount(e,owner,'meals')<1)return false;
  const id=l.nextActivity??0;l.nextActivity=id+1;
  const s:SocialActivity={activity:p.activity,placeId:p.placeId,...(p.destinationId?{destinationId:p.destinationId}:{}),id,proposer:owner,participants:[owner,partner],acceptedBy:[owner],created:l.clock,due:l.clock+p.delayMinutes*WORLD_MINUTE_MS,expires:l.clock+Math.max(120000,p.delayMinutes*WORLD_MINUTE_MS+120000),hardExpires:l.clock+p.delayMinutes*WORLD_MINUTE_MS+720000,status:'proposed',deadlineStage:'proposed',ate:[]};
  l.activities=[...l.activities.filter(unfinished),...l.activities.filter(s=>!unfinished(s)).slice(-15),s];
  lifeEvent(l,now,'activity_proposed',`Proposed ${p.activity} together at ${places.find(x=>x.id===p.placeId)!.name}, ${p.delayMinutes===0?'now':`in ${p.delayMinutes} village minutes`}; invitation #${id}.`,s.participants);return true;
}
export function respondActivity(game:Game,id:number,owner:string,response:'accept'|'decline'|'cancel',now:number,reason?:string){
  const l=game.world.livelihood,e=game.world.economy,s=l?.activities?.find(s=>s.id===id);
  if(!l||!e||!s||!unfinished(s)||!s.participants.includes(owner))return false;
  if(response==='cancel'||response==='decline'){
    if(response==='decline'&&s.status!=='proposed')return false;
    s.status=response==='cancel'?'cancelled':'declined';s.finishedAt=l.clock;s.outcome=`${game.playerDescriptions?.get(parseGameId('players',owner))?.name??owner} ${response==='cancel'?'cancelled the shared plan':'declined the invitation'}.`;
    if(reason)s.outcome+=' '+reason.slice(0,160);
    lifeEvent(l,now,`activity_${s.status}`,`${s.activity} invitation #${id}: ${s.outcome}`,s.participants);return true;
  }
  if(s.status!=='proposed'||s.acceptedBy.includes(owner)||l.clock>=s.expires)return false;
  if(s.activity==='meal'&&foodCount(e,owner,'meals')<1)return false;
  if(l.activities!.some(o=>o!==s&&unfinished(o)&&o.acceptedBy.includes(owner)))return false;
  s.acceptedBy.push(owner);
  if(s.participants.every(id=>s.acceptedBy.includes(id))){s.status='scheduled';stageDeadline(game,s);lifeEvent(l,now,'activity_accepted',`Both residents accepted ${s.activity} invitation #${id}. Attendance and completion are still pending.`,s.participants);}
  return true;
}
export function tickSocialActivities(game:Game,now:number){
  const l=game.world.livelihood,e=game.world.economy;if(!l||!e)return;
  for(const s of l.activities??[]){
    if(!unfinished(s))continue;
    const places=activityPlaces(game),place=places.find(p=>p.id===s.placeId);
    const members=s.participants.map(id=>game.world.players.get(parseGameId('players',id)));
    if(s.deadlineStage!==s.status&&s.status!=='proposed')stageDeadline(game,s);
    if(!place||members.some(p=>!p)||l.clock>=s.expires){s.status='missed';s.finishedAt=l.clock;s.outcome='The activity could not complete its current stage before the deadline.';lifeEvent(l,now,'activity_missed',`${s.activity} invitation #${s.id} was missed.`,s.participants);continue;}
    if(s.status==='proposed'||l.clock<s.due)continue;
    if(s.participants.some(id=>l.offers.some(o=>['accepted','cooking'].includes(o.status)&&o.participants.includes(id))))continue;
    if(s.status==='scheduled'){s.status='gathering';s.gatheringAt=l.clock;s.deadlineStage='gathering';}
    if(s.status==='gathering'){
      if(!members.every(p=>Math.hypot(p!.position.x-place.position.x,p!.position.y-place.position.y)<2.3))continue;
      if(s.activity==='meal'&&!s.participants.every(id=>foodCount(e,id,'meals')>0)){s.status='cancelled';s.outcome='A required meal was unavailable; nothing was eaten.';lifeEvent(l,now,'activity_cancelled',s.outcome,s.participants);continue;}
      s.status='active';s.started=l.clock;stageDeadline(game,s);lifeEvent(l,now,'activity_started',`Started ${s.activity} together at ${place.name}; invitation #${s.id}.`,s.participants);
    }
    if(s.activity==='walk'){
      const destination=places.find(p=>p.id===s.destinationId);
      if(!destination){s.status='cancelled';continue;}
      if(!members.every(p=>Math.hypot(p!.position.x-destination.position.x,p!.position.y-destination.position.y)<2.3))continue;
    }else if(s.activity==='help'){
      const g=game.world.garden,owner=g&&game.world.players.get(parseGameId('players',g.owner));if(!g||!owner){s.status='cancelled';continue;}
      if(members.some(p=>{const c=game.world.playerConversation(p!);return c&&!c.casual;}))continue;
      if(!g.job&&g.time<g.nextJob)continue;
      if(!g.job){const bed=g.beds.find(b=>b.state==='ready')??(g.seeds>0?g.beds.find(b=>b.state==='empty'):undefined);if(bed)g.job={bed:bed.id,kind:bed.state==='ready'?'harvest':'plant',requested:g.time};}
      const bed=g.beds.find(b=>b.id===g.job?.bed);
      if(bed&&members.some(p=>Math.hypot(p!.position.x-bed.x,p!.position.y-bed.y)>3)){if(g.job)delete g.job.started;continue;}
      const work=workGarden(g,owner.position,now);
      if(work?.destination)continue;
      if(work?.label==='Finished garden work'){if(g.events.at(-1)?.kind==='harvest')l.produced.turnips+=2;}
      else if(work)continue;
      else {s.status='cancelled';s.outcome='No garden work was available.';lifeEvent(l,now,'activity_cancelled',s.outcome,s.participants);continue;}
    }else {
      if(!members.every(p=>Math.hypot(p!.position.x-place.position.x,p!.position.y-place.position.y)<2.3)){s.status='gathering';s.gatheringAt=l.clock;delete s.started;stageDeadline(game,s);continue;}
      if(s.activity==='meal'&&l.clock-s.started!>=10000)for(const id of s.participants){if(!s.ate.includes(id)&&eat(l,e,id,'meals',now))s.ate.push(id);}
      if(l.clock-s.started!<(s.activity==='meal'?20000:12000))continue;
    }
    s.status='completed';s.finishedAt=l.clock;s.outcome=s.activity==='meal'?`Shared a meal-time visit; ${s.ate.length} residents actually ate. Others kept company without eating.`:s.activity==='help'?'Completed garden work together.':s.activity==='walk'?'Walked together to the destination.':'Spent a quiet visit together.';
    lifeEvent(l,now,'activity_completed',`${s.outcome} Invitation #${s.id}.`,s.participants);
  }
}
export function socialActivityWork(game:Game,owner:string,now:number){
  const l=game.world.livelihood,p=game.world.players.get(parseGameId('players',owner));
  const s=l?.activities?.find(s=>s.acceptedBy.includes(owner)&&['scheduled','gathering','active'].includes(s.status)&&l.clock>=s.due);
  if(!l||!p||!s)return null;
  const place=activityPlaces(game).find(x=>x.id===(s.status==='active'&&s.activity==='walk'?s.destinationId:s.placeId));if(!place)return null;
  if(game.world.playerConversation(p)&&!game.world.playerConversation(p)?.casual)return {id:s.id,active:s.status==='active',moving:s.status!=='active',activity:s.activity};
  let target=place.position;
  if(s.status==='active'&&s.activity==='help'){
    const g=game.world.garden,bed=g?.beds.find(b=>b.id===g.job?.bed);if(bed)target=owner===g!.owner?{x:bed.x,y:bed.y}:{x:bed.x+1,y:bed.y};
  }
  if(s.activity==='walk'&&s.status==='active'){
    const partners=s.participants.filter(id=>id!==owner).map(id=>game.world.players.get(parseGameId('players',id))).filter(p=>!!p);
    const ahead=partners.some(other=>Math.hypot(p.position.x-other!.position.x,p.position.y-other!.position.y)>3&&Math.hypot(p.position.x-target.x,p.position.y-target.y)<Math.hypot(other!.position.x-target.x,other!.position.y-target.y));
    if(ahead){stopPlayer(p);p.activity={description:'Waiting for a walking companion',until:now+1000};return {id:s.id,active:true,moving:false,activity:s.activity};}
  }
  const tolerance=s.activity==='help'&&owner===game.world.garden?.owner&&s.status==='active'?0.5:1.6;
  if(Math.hypot(p.position.x-target.x,p.position.y-target.y)>tolerance){if(!p.pathfinding)movePlayer(game,now,p,target);}
  else stopPlayer(p);
  p.activity={description:s.status==='active'?s.activity==='meal'?'Sharing a meal and company':s.activity==='help'?'Helping with the garden':s.activity==='walk'?'Walking together':'Visiting a neighbor':`Going to an agreed ${s.activity}`,until:now+1000};
  return {id:s.id,active:s.status==='active',moving:!!p.pathfinding,activity:s.activity};
}
