import { recordSocial } from './social';
import { v } from 'convex/values';
import { DatabaseReader, MutationCtx, internalMutation } from './_generated/server';
import { Id } from './_generated/dataModel';
import { speechSignals, sameStatement } from './agent/memorySignals';

export async function recordLivelihoodEvent(ctx:MutationCtx,worldId:Id<'worlds'>,event:{id:number;kind:string;text:string;at:number;witnesses:string[]}){
  const source=`livelihood:${worldId}:${event.id}`;
  if(await ctx.db.query('memoryEvents').withIndex('source',q=>q.eq('worldId',worldId).eq('source',source)).unique())return;
  const eventId=await ctx.db.insert('memoryEvents',{worldId,source,context:'Verified food and exchange event',speaker:event.witnesses[0],speakerName:'World event',text:event.text,witnesses:event.witnesses,occurredAt:event.at,inactive:false,signalsProcessed:true});
  const completed=['barter','gift','cooking_agreement','activity_completed'].includes(event.kind);
  for(const owner of event.witnesses){
    await ctx.db.insert('memoryPerspectives',{worldId,owner,eventId,kind:['offer','declined','expired','accepted','activity_proposed','activity_accepted','activity_cancelled','activity_declined','activity_missed'].includes(event.kind)?'heard':'did',occurredAt:event.at});
    if(completed)for(const target of event.witnesses.filter(p=>p!==owner)){
      if(event.kind==='activity_completed'){const recent=await ctx.db.query('relationshipChanges').withIndex('edge',q=>q.eq('worldId',worldId).eq('owner',owner).eq('target',target)).order('desc').take(10);if(recent.some(r=>r.kind==='shared_followthrough'&&event.at-r.occurredAt<300000))continue;}
      await ctx.db.insert('relationshipChanges',{worldId,owner,target,eventId,occurredAt:event.at,kind:event.kind==='activity_completed'?'shared_followthrough':'verified_trade',sentiment:event.kind==='activity_completed'?'Followed through on a shared activity.':'Followed through on an explicitly agreed exchange.',delta:{trust:1}});
    }
  }
}

export async function recordPlaceVisit(ctx:MutationCtx,worldId:Id<'worlds'>,event:{id:number;owner:string;text:string;at:number}){
  const source=`village:${worldId}:${event.id}`;
  if(await ctx.db.query('memoryEvents').withIndex('source',q=>q.eq('worldId',worldId).eq('source',source)).unique())return;
  const eventId=await ctx.db.insert('memoryEvents',{worldId,source,context:'Verified village visit',speaker:event.owner,speakerName:'World event',text:event.text,witnesses:[event.owner],occurredAt:event.at,inactive:false,signalsProcessed:true});
  await ctx.db.insert('memoryPerspectives',{worldId,owner:event.owner,eventId,kind:'did',occurredAt:event.at});
}

export async function recordGardenAction(ctx:MutationCtx,worldId:Id<'worlds'>,owner:string,event:{id:number;text:string;at:number}){
  const source=`garden:${worldId}:${event.id}`;
  const existing=await ctx.db.query('memoryEvents').withIndex('source',q=>q.eq('worldId',worldId).eq('source',source)).unique();
  if(existing)return;
  const eventId=await ctx.db.insert('memoryEvents',{worldId,source,context:'Verified garden action',speaker:owner,speakerName:'Bob',text:event.text,witnesses:[owner],occurredAt:event.at,inactive:false,signalsProcessed:true});
  await ctx.db.insert('memoryPerspectives',{worldId,owner,eventId,kind:'did',occurredAt:event.at});
}
export async function recordEconomyAction(ctx:MutationCtx,worldId:Id<'worlds'>,event:{id:number;text:string;at:number;kind:string;witnesses:string[]}){
  const source=`economy:${worldId}:${event.id}`;
  if(await ctx.db.query('memoryEvents').withIndex('source',q=>q.eq('worldId',worldId).eq('source',source)).unique())return;
  const witnesses=[...new Set(event.witnesses)];if(!witnesses.length)return;
  const eventId=await ctx.db.insert('memoryEvents',{worldId,source,context:'Verified world action',speaker:witnesses[0],speakerName:'World event',text:event.text,witnesses,occurredAt:event.at,inactive:false,signalsProcessed:true});
  for(const owner of witnesses){
    await ctx.db.insert('memoryPerspectives',{worldId,owner,eventId,kind:'did',occurredAt:event.at});
    if(event.kind==='trade')for(const target of witnesses.filter(id=>id!==owner))await ctx.db.insert('relationshipChanges',{worldId,owner,target,eventId,occurredAt:event.at,kind:'verified_trade',sentiment:'Completed the agreed exchange in person.',delta:{trust:1}});
  }
}

// The fact recorded here is that words were spoken, not that their content is true.
// Witnesses come from actual conversation membership, never proximity or all residents.
export async function recordSpeech(ctx: MutationCtx, event: {
  worldId: Id<'worlds'>; source: string; context: string; speaker: string;
  speakerName: string; text: string; witnesses: string[]; occurredAt: number;
}, deriveTextSignals=true) {
  if (!event.text.trim()) return;
  const existing = await ctx.db.query('memoryEvents').withIndex('source', q =>
    q.eq('worldId', event.worldId).eq('source', event.source)).unique();
  if (existing?.signalsProcessed || existing?.inactive) return existing._id;
  if(existing) event={worldId:existing.worldId,source:existing.source,context:existing.context,
    speaker:existing.speaker,speakerName:existing.speakerName,text:existing.text,witnesses:existing.witnesses,occurredAt:existing.occurredAt};
  const witnesses = [...new Set([...event.witnesses, event.speaker])];
  const eventId = existing?existing._id:await ctx.db.insert('memoryEvents', {...event, witnesses, inactive: false});
  if(!existing) for (const owner of witnesses) await ctx.db.insert('memoryPerspectives', {
    worldId: event.worldId, owner, eventId, occurredAt: event.occurredAt,
    kind: owner === event.speaker ? 'said' : 'heard',
  });
  // Structured-action dialogue keeps verbatim memory; commitments and outcomes
  // come from its engine journal, not phrase matching or sentiment rules.
  if(!deriveTextSignals){await ctx.db.patch(eventId,{signalsProcessed:true});return eventId;}
  const signals=speechSignals(event.text);
  // Each witness remembers an attributed belief, never adopts it as their own.
  for(const owner of witnesses){
    if(!signals.beliefs.length&&!signals.promises.length&&!signals.resolutions.length) continue;
    const prior=await ctx.db.query('characterBeliefs').withIndex('owner',q=>q.eq('worldId',event.worldId).eq('owner',owner)).order('desc').take(30);
    for(const belief of signals.beliefs){
      const previous=belief.previous?prior.find(b=>b.subject===event.speaker&&sameStatement(b.statement,belief.previous!)):undefined;
      await ctx.db.insert('characterBeliefs',{worldId:event.worldId,owner,subject:event.speaker,subjectName:event.speakerName,
        statement:belief.statement,eventId,occurredAt:event.occurredAt,...(previous?{supersedes:previous._id}:{})});
    }
    for(const task of signals.promises) await ctx.db.insert('characterPromises',{worldId:event.worldId,owner,
      promiser:event.speaker,promiserName:event.speakerName,task,eventId,occurredAt:event.occurredAt});
    if(signals.resolutions.length){
      const promises=await ctx.db.query('characterPromises').withIndex('promiser_resolution',q=>q.eq('worldId',event.worldId).eq('owner',owner).eq('promiser',event.speaker).eq('resolution',undefined)).order('desc').collect();
      for(const resolution of signals.resolutions){
        const promise=promises.find(p=>p.promiser===event.speaker&&!p.resolutionEventId&&sameStatement(p.task,resolution.task));
        if(promise) await ctx.db.patch(promise._id,{resolutionEventId:eventId,resolution:resolution.kind});
      }
    }
  }
  await ctx.db.patch(eventId,{signalsProcessed:true});
  await recordSocial(ctx,eventId);
  return eventId;
}

export const upgradeRecent = internalMutation({args:{},handler:async ctx=>{
  const events=await ctx.db.query('memoryEvents').order('desc').take(50);
  let upgraded=0;
  for(const e of events) if(!e.inactive&&!e.signalsProcessed){
    await recordSpeech(ctx,{worldId:e.worldId,source:e.source,context:e.context,speaker:e.speaker,
      speakerName:e.speakerName,text:e.text,witnesses:e.witnesses,occurredAt:e.occurredAt});upgraded++;
  }
  return {upgraded};
}});

export async function recallGraph(ctx: {db: DatabaseReader}, worldId: Id<'worlds'>, owner: string) {
  const edges = await ctx.db.query('memoryPerspectives').withIndex('owner', q =>
    q.eq('worldId', worldId).eq('owner', owner)).order('desc').take(24);
  const entries = await Promise.all(edges.map(async edge => {
    const event = await ctx.db.get(edge.eventId);
    if (!event || event.inactive || !event.witnesses.includes(owner)) return null;
    return {id: event._id, kind: edge.kind, speaker: event.speakerName,
      text: event.text, context: event.context, occurredAt: event.occurredAt, source: event.source};
  }));
  return entries.filter((e): e is NonNullable<typeof e> => e !== null).slice(0, 6);
}

export function graphPrompt(entries: Awaited<ReturnType<typeof recallGraph>>) {
  return entries.length ? '\nYour witnessed experiences (quotes are claims, not verified facts; these are past events, not obligations):\n' +
    entries.map(e => `${new Date(e.occurredAt).toISOString()}: ${e.kind==='did'?'Your verified action':e.kind === 'said' ? 'You said' : `You heard ${e.speaker} say`} “${e.text.slice(0, 220)}”`).join('\n') : '';
}

export async function recallCharacter(ctx:{db:DatabaseReader},worldId:Id<'worlds'>,owner:string){
  const beliefs=await ctx.db.query('characterBeliefs').withIndex('owner',q=>q.eq('worldId',worldId).eq('owner',owner)).order('desc').take(30);
  const promises=await ctx.db.query('characterPromises').withIndex('owner',q=>q.eq('worldId',worldId).eq('owner',owner)).order('desc').take(30);
  const visible=async(id:Id<'memoryEvents'>)=>{const e=await ctx.db.get(id);return !!e&&!e.inactive&&e.witnesses.includes(owner);};
  const validBeliefs=(await Promise.all(beliefs.map(async b=>await visible(b.eventId)?b:null))).filter((b):b is NonNullable<typeof b>=>!!b);
  const superseded=new Set(validBeliefs.map(b=>b.supersedes).filter(Boolean));
  const currentBeliefs=validBeliefs.filter(b=>!superseded.has(b._id)).slice(0,6);
  const validPromises=(await Promise.all(promises.map(async p=>{
    if(!await visible(p.eventId)) return null;
    const resolved=p.resolutionEventId&&await visible(p.resolutionEventId);
    return {...p,status:resolved?p.resolution!:'open'};
  }))).filter((p):p is NonNullable<typeof p>=>!!p);
  const experiences=await recallGraph(ctx,worldId,owner);
  const relationships=[...new Set(experiences.filter(e=>e.kind==='heard').map(e=>e.speaker))].map(name=>({name,
    recentStatements:experiences.filter(e=>e.kind==='heard'&&e.speaker===name).length,
    lastHeard:experiences.find(e=>e.kind==='heard'&&e.speaker===name)!.occurredAt}));
  return {beliefs:currentBeliefs,promises:validPromises.filter(p=>p.status==='open').concat(validPromises.filter(p=>p.status!=='open')).slice(0,8),relationships};
}

export function characterPrompt(memory:Awaited<ReturnType<typeof recallCharacter>>,owner:string){
  const beliefs=memory.beliefs.map(b=>`${b.subject===owner?'You believe':`${b.subjectName} said they believe`}: ${b.statement}`);
  const promises=memory.promises.filter(p=>p.status==='open').slice(0,4).map(p=>`${p.promiser===owner?'You':p.promiserName} explicitly promised to ${p.task}. Completion is unknown.`);
  return beliefs.length||promises.length?'\nPersonal memory notes (beliefs can be wrong; never impersonate another person or invent completion):\n'+[...beliefs,...promises].join('\n'):'';
}

// Explicitly retire a source without deleting its evidence or historical edges.
export const retire = internalMutation({args: {eventId: v.id('memoryEvents')}, handler: async (ctx, {eventId}) => {
  await ctx.db.patch(eventId, {inactive: true});
}});
