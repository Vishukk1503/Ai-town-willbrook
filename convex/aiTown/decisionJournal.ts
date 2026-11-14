import {v,Infer} from 'convex/values';
import type {Game} from './game';
import {availableActions} from './actionChoice';
import {initialAwareness} from './awareness';
export const journalEvent=v.object({key:v.string(),playerId:v.string(),at:v.number(),clock:v.number(),phase:v.string(),summary:v.string(),status:v.optional(v.string()),relatedKey:v.optional(v.string()),dataJson:v.optional(v.string()),choice:v.optional(v.object({requestedAction:v.string(),actionId:v.string(),kind:v.string(),label:v.string(),reason:v.string(),source:v.string(),bodyJson:v.string(),menuJson:v.string(),parentKey:v.optional(v.string())}))});
export type JournalEvent=Infer<typeof journalEvent>;
export const encode=(value:unknown)=>JSON.stringify(value);
export function bodyState(game:Game,owner:string){
 const w=game.world,p=[...w.players.values()].find(p=>p.id===owner),a=[...w.agents.values()].find(a=>a.playerId===owner),n=w.livelihood?.needs.find(n=>n.owner===owner);
 return {needs:n?{hunger:n.hunger,energy:n.energy,restedness:n.restedness??65}:undefined,position:p?{...p.position}:undefined,inventory:w.economy?.bags.find(b=>b.owner===owner)?{...w.economy.bags.find(b=>b.owner===owner)!.items}:undefined,mood:a?.awareness?{pleasantness:a.awareness.pleasantness,stress:a.awareness.stress,socialReadiness:a.awareness.socialReadiness}:undefined};
}
export function journal(game:Game,key:string,owner:string,now:number,phase:string,summary:string,extra:Partial<JournalEvent>={}){
 (game.decisionEvents??=[]).push({key,playerId:owner,at:now,clock:game.world.clock?.elapsedMs??0,phase,summary,...extra});
}
export function auditChoice<T>(game:Game,now:number,args:{agentId:string;operationId:string;action:string;reason:string;source:string;auditNote?:string},run:()=>T):T{
 const a=[...game.world.agents.values()].find(a=>a.id===args.agentId),owner=a?.playerId??'unknown',matches=a?.inProgressOperation?.operationId===args.operationId;
 const priorPlan=JSON.stringify(a?.learning??null);
 const body=bodyState(game,owner),prior=a?.decision,oldConversations=new Set(game.world.conversations.keys()),oldOffers=new Set(game.world.livelihood?.offers.map(o=>o.id)),oldSessions=new Set(game.world.livelihood?.activities?.map(o=>o.id));
 const options=a?availableActions({...game.world.serialize(),awareness:a.awareness??initialAwareness(),currentDecision:a.decision,lastWakeClock:a.lastWakeClock},owner,now,a.lastInviteAttempt,a.lastConversation,game.playerDescriptions.get(a.playerId)?.name??''):[];
 const oldOfferState=new Map((game.world.livelihood?.offers??[]).map(o=>[o.id,JSON.stringify(o)])),oldSessionState=new Map((game.world.livelihood?.activities??[]).map(o=>[o.id,JSON.stringify(o)]));
 let failed=false;
 try{return run();}catch(error){failed=true;throw error;}finally{
  if(a&&priorPlan!==JSON.stringify(a.learning??null))journal(game,args.operationId,owner,now,'plan_state',a.learning?.lastOutcome??'Plan state changed.',{dataJson:encode({plan:a.learning?.active})});
  if(!matches){journal(game,args.operationId,owner,now,'rejected','Late or duplicate decision input was ignored.',{status:'rejected',dataJson:encode({requestedAction:args.action})});}
  else{
   const changed=!!a?.decision&&a.decision!==prior,selected=changed?options.find(o=>o.id===a!.decision!.actionId):options.find(o=>o.id===args.action);
   const kind=changed?a!.decision!.kind:selected?.kind??'unknown',id=changed?a!.decision!.actionId??kind:selected?.id??args.action;
   let relatedKey:string|undefined;
   if(kind==='talk'||kind==='casual'){const c=[...game.world.conversations.values()].find(c=>!oldConversations.has(c.id)&&c.participants.has(a!.playerId));if(c)relatedKey='conversation:'+c.id;}
   if(kind==='offer'||kind==='respond'){const o=game.world.livelihood?.offers.find(o=>!oldOffers.has(o.id));const offerId=o?.id??(selected as any)?.offerId;if(offerId!==undefined)relatedKey='offer:'+offerId;}
   if(kind==='activityOffer'||kind==='activityResponse'){const s=game.world.livelihood?.activities?.find(s=>!oldSessions.has(s.id));const sessionId=s?.id??(selected as any)?.activityId;if(sessionId!==undefined)relatedKey='activity:'+sessionId;}
   const accepted=!!selected&&!failed&&(changed||['casual','quiet','continue','activityOffer','activityResponse','offer','respond'].includes(kind)),command=['quiet','continue'].includes(kind);
   const changedRelated=kind==='respond'?game.world.livelihood?.offers.some(o=>oldOfferState.get(o.id)!==JSON.stringify(o)):kind==='activityResponse'?game.world.livelihood?.activities?.some(o=>oldSessionState.get(o.id)!==JSON.stringify(o)):true;
   const rejected=!accepted||!changedRelated||(['talk','casual','offer','respond','activityOffer','activityResponse'].includes(kind)&&!relatedKey);
   const isFallback=changed&&id!==args.action;
   journal(game,args.operationId,owner,now,'selection',rejected?'Choice was rejected or became unavailable.':isFallback?'Requested action became unavailable; engine selected a safe fallback.':'Choice accepted by the engine.',{status:rejected?'rejected':command?'completed':'accepted',relatedKey,choice:{requestedAction:args.action,actionId:id,kind,label:changed?a!.decision!.label:selected?.label??args.action,reason:changed?a!.decision!.reason:args.reason,source:isFallback?'fallback':args.source,bodyJson:encode(body),menuJson:encode(options),parentKey:prior?.auditKey},dataJson:encode({needsAtSelection:body.needs,selectedDestination:changed?a!.decision!.destination:undefined,revalidated:!!selected,exception:failed,fallbackReason:args.auditNote})});
   if(changed&&a?.decision){
     a.decision.auditKey=args.operationId;a.decision.needsAtChoice=body.needs;a.decision.auditEnded=rejected;
     if(prior?.auditKey)journal(game,prior.auditKey,owner,now,'superseded','A new choice replaced or suspended the prior intention.',{status:'interrupted',dataJson:encode(body)});
     const path=game.world.players.get(a.playerId)?.pathfinding;if(path&&!rejected)journal(game,args.operationId,owner,now,'moving','Started the selected route.',{status:'in_progress',dataJson:encode({destination:path.destination})});
   }
   if(command)journal(game,args.operationId,owner,now,'completed',kind==='continue'?'Continue instruction accepted; the original task keeps its own outcome record.':'Quiet company chosen; no completed work or transfer is implied.',{status:'completed'});
  }
 }
}
type Probe=ReturnType<typeof probe>;
export function probe(game:Game){
 const w=game.world;
 return {agents:[...w.agents.values()].map(a=>({id:a.id,owner:a.playerId,planState:JSON.stringify(a.learning??null),decision:a.decision?{...a.decision}:undefined,operation:a.inProgressOperation?{...a.inProgressOperation}:undefined,sleep:a.sleep?{...a.sleep}:undefined,path:!!w.players.get(a.playerId)?.pathfinding,destination:w.players.get(a.playerId)?.pathfinding?.destination})),
 lifeNext:w.livelihood?.nextEvent??0,economyNext:w.economy?.nextEvent??0,gardenNext:w.garden?.nextEvent??0,villageNext:w.village?.nextEvent??0,
 links:[...(w.livelihood?.offers??[]).map(o=>({messages:0,relatedKey:'offer:'+o.id,status:o.status,summary:o.kind+' agreement #'+o.id})),...(w.livelihood?.activities??[]).map(s=>({messages:0,relatedKey:'activity:'+s.id,status:s.status,summary:s.outcome??s.activity+' plan #'+s.id})),...[...w.conversations.values()].map(c=>({relatedKey:'conversation:'+c.id,status:'active',summary:'Conversation with '+c.numMessages+' messages',messages:c.numMessages}))]};
}
const matchEvents:Record<string,string[]>={eat:['eat'],cook:['cook'],collect:['collect'],forage:['forage'],fish:['fish'],garden:['plant','harvest'],place:['visit']};
export function observeTick(game:Game,before:Probe,now:number){
 const w=game.world;
 const facts=[...(w.livelihood?.events??[]).filter(e=>e.id>=before.lifeNext).map(e=>({...e,ref:'life:'+e.id})),...(w.economy?.events??[]).filter(e=>e.id>=before.economyNext).map(e=>({...e,ref:'economy:'+e.id})),...(w.garden?.events??[]).filter(e=>e.id>=before.gardenNext).map(e=>({...e,witnesses:[w.garden!.owner],ref:'garden:'+e.id})),...(w.village?.events??[]).filter(e=>e.id>=before.villageNext).map(e=>({...e,kind:'visit',witnesses:[e.owner],ref:'village:'+e.id}))];
 for(const a of w.agents.values()){
  const old=before.agents.find(p=>p.id===a.id),p=w.players.get(a.playerId),d=a.decision;
  if(old&&old.planState!==JSON.stringify(a.learning??null))journal(game,d?.auditKey??('plan:'+a.id),a.playerId,now,'plan_state',a.learning?.lastOutcome??'Plan state changed.',{dataJson:encode({plan:a.learning?.active})});
  if(d&&!d.auditKey){
   const fresh=!old?.decision||old.decision.chosenAt!==d.chosenAt||old.decision.kind!==d.kind;
   const key=(fresh?'engine:':'legacy:')+a.id+':'+d.chosenAt+':'+d.kind;d.auditKey=key;if(fresh)d.needsAtChoice=bodyState(game,a.playerId).needs;
   journal(game,key,a.playerId,now,fresh?'selection':'observed_existing',fresh?'Engine-controlled intention or recovery safeguard.':'Existing intention observed when logging began; original menu and needs were not recorded.',{status:'accepted',relatedKey:d.kind==='joint'&&a.jointSessionId!==undefined?'activity:'+a.jointSessionId:undefined,choice:{requestedAction:d.actionId??d.kind,actionId:d.actionId??d.kind,kind:d.kind,label:d.label,reason:d.reason,source:fresh?'engine':'preexisting',bodyJson:fresh?encode(bodyState(game,a.playerId)):'{}',menuJson:'[]'}});
  }
  if(d?.auditKey&&old?.decision?.auditKey!==d.auditKey&&d.auditKey.startsWith('engine:')===false)journal(game,d.auditKey,a.playerId,now,'resumed','Resumed an earlier intention.',{status:'in_progress',dataJson:encode(bodyState(game,a.playerId))});
  const primary=old?.decision?.auditKey?old.decision:d,key=primary?.auditKey;
  if(key&&primary){
   const fact=facts.find(e=>e.witnesses.includes(a.playerId)&&(matchEvents[primary.kind]??[]).includes(e.kind));
   if(fact)journal(game,key,a.playerId,now,'evidence',fact.text,{status:fact.kind==='fish'&&/did not catch/i.test(fact.text)?'failed':'completed',dataJson:encode({event:fact,body:bodyState(game,a.playerId)})});
   const wasSleeping=old?.sleep?.phase==='asleep';
   if(primary.kind==='sleep'&&old?.sleep?.phase==='going_home'&&a.sleep?.phase==='asleep')journal(game,key,a.playerId,now,'sleeping','Reached home and started sleep.',{status:'in_progress',dataJson:encode({sleep:a.sleep,body:bodyState(game,a.playerId)})});
   if(primary.kind==='sleep'&&wasSleeping&&!a.sleep)journal(game,key,a.playerId,now,'woke','Sleep ended; the following state is the measured recovery.',{status:(bodyState(game,a.playerId).needs?.hunger??0)>=90?'interrupted':'completed',dataJson:encode({body:bodyState(game,a.playerId)})});
   else if(primary.kind==='sleep'&&old?.sleep&&!a.sleep&&!wasSleeping)journal(game,key,a.playerId,now,'failed','Sleep journey ended before sleep began.',{status:'failed',dataJson:encode(bodyState(game,a.playerId))});
   if(primary.kind==='rest'&&d?.until!==undefined&&d.until<=now&&!d.auditEnded)journal(game,key,a.playerId,now,'recovered','Short rest ended.',{status:'completed',dataJson:encode(bodyState(game,a.playerId))});
   if(old?.path&&!p?.pathfinding&&['wander','walk','visit'].includes(primary.kind)){
    const destination=primary.destination??old.destination,arrived=!!destination&&!!p&&Math.hypot(p.position.x-destination.x,p.position.y-destination.y)<1.6;
    journal(game,key,a.playerId,now,'route_ended',arrived?'Reached the chosen destination.':'Route stopped before arrival was confirmed.',{status:arrived?'completed':'unverified',dataJson:encode({destination,body:bodyState(game,a.playerId)})});
   }else if(old?.path&&!p?.pathfinding){const destination=old.destination,arrived=!!destination&&!!p&&Math.hypot(p.position.x-destination.x,p.position.y-destination.y)<1.6;journal(game,key,a.playerId,now,arrived?'arrived':'route_paused',arrived?'Arrived at the task location; the task is not yet confirmed complete.':'Route paused or stopped; arrival is not confirmed.',{dataJson:encode({destination,body:bodyState(game,a.playerId)})});}
   else if(!old?.path&&p?.pathfinding)journal(game,d?.auditKey??key,a.playerId,now,'moving','Started a route.',{status:'in_progress',dataJson:encode({destination:p.pathfinding.destination})});
   if(old?.decision?.auditKey&&d?.auditKey!==old.decision.auditKey)journal(game,old.decision.auditKey,a.playerId,now,'superseded','The intention was replaced, suspended or interrupted; no completion is inferred.',{status:'interrupted',dataJson:encode(bodyState(game,a.playerId))});
   else if(d&&d.until<=now&&!d.auditEnded&&!fact&&!['rest','sleep','offer','respond','activityOffer','activityResponse','joint','talk','casual'].includes(primary.kind))journal(game,key,a.playerId,now,'intent_ended','Intention ended without a matching completion event.',{status:'unverified',dataJson:encode(bodyState(game,a.playerId))});
   if(d&&d.until<=now)d.auditEnded=true;
  }
  if(old?.operation?.name==='agentChooseAction'&&old.operation.operationId!==a.inProgressOperation?.operationId)journal(game,old.operation.operationId,a.playerId,now,'request_released','Pending action request ended or was cancelled.',{status:'cancelled'});
 }
 for(const fact of facts)(game.decisionEvents??=[]).push({key:'fact:'+fact.ref,playerId:'*',at:fact.at,clock:w.clock?.elapsedMs??0,phase:fact.kind,summary:fact.text,dataJson:encode(fact)});
 const after=probe(game).links;
 for(const link of after){const old=before.links.find(l=>l.relatedKey===link.relatedKey);if(old?.status===link.status)continue;(game.decisionEvents??=[]).push({key:'link:'+link.relatedKey,playerId:'*',at:now,clock:w.clock?.elapsedMs??0,phase:link.status,relatedKey:link.relatedKey,summary:link.summary,status:['completed','declined','cancelled','expired','missed','countered'].includes(link.status)?link.status==='completed'?'completed':'cancelled':'in_progress'});}
 for(const old of before.links.filter(l=>l.relatedKey.startsWith('conversation:')&&!after.some(n=>n.relatedKey===l.relatedKey)))(game.decisionEvents??=[]).push({key:'link:'+old.relatedKey,playerId:'*',at:now,clock:w.clock?.elapsedMs??0,phase:'conversation_ended',relatedKey:old.relatedKey,summary:('messages' in old?old.messages:0)?'Conversation ended after '+old.messages+' committed messages.':'Invitation ended without a committed message.',status:old.messages?'completed':'cancelled'});
}
