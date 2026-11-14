import { internalMutation, DatabaseReader, MutationCtx } from './_generated/server';
import { Id, Doc } from './_generated/dataModel';
import { socialProfiles, startingRelationships, neutral } from '../data/socialProfiles';
import { applyChanges, chooseIntention, describeRelationship, interpretSpeech } from './agent/socialRules';
import { sameStatement } from './agent/memorySignals';

export async function seedSocial(ctx:MutationCtx,worldId:Id<'worlds'>){
  const world=await ctx.db.get(worldId);if(!world)throw new Error('World not found');
  const descriptions=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',worldId)).collect();
  const cast=world.agents.map(a=>descriptions.find(p=>p.playerId===a.playerId)).filter((p):p is NonNullable<typeof p>=>!!p);
  for(const person of cast){
    const profile=socialProfiles[person.name];if(!profile)continue;
    const sheet=await ctx.db.query('characterSheets').withIndex('player',q=>q.eq('worldId',worldId).eq('playerId',person.playerId)).unique();
    if(!sheet)await ctx.db.insert('characterSheets',{worldId,playerId:person.playerId,name:person.name,...profile,source:'authored-v1'});
    const edges=await ctx.db.query('relationshipBaselines').withIndex('owner',q=>q.eq('worldId',worldId).eq('owner',person.playerId)).collect();
    for(const other of cast){if(other.playerId===person.playerId||edges.some(e=>e.target===other.playerId))continue;
      const baseline=startingRelationships[`${person.name}:${other.name}`];
      await ctx.db.insert('relationshipBaselines',{worldId,owner:person.playerId,target:other.playerId,targetName:other.name,
        scores:baseline?.scores??neutral,story:baseline?.story??'No authored relationship history.',source:'authored-v1'});
    }
  }
  return {characters:cast.length};
}
export const initialize=internalMutation({args:{},handler:async ctx=>{
  const status=await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();
  if(!status)throw new Error('No town');return seedSocial(ctx,status.worldId);
}});

export async function recordSocial(ctx:MutationCtx,eventId:Id<'memoryEvents'>){
  const e=await ctx.db.get(eventId);if(!e||e.inactive)return;
  const descriptions=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',e.worldId)).collect();
  const others=[...new Set(e.witnesses)].filter(id=>id!==e.speaker);
  // In a group, only an unambiguous named addressee receives a direct social interpretation.
  const addressed=others.filter(id=>{
    const name=descriptions.find(p=>p.playerId===id)?.name;
    return name&&e.text.toLowerCase().startsWith(name.toLowerCase()+',');
  });
  const targets=others.length===1?others:addressed.length===1?addressed:[];
  for(const recipient of targets){
    const name=descriptions.find(p=>p.playerId===recipient)?.name??recipient;
    const meaning=interpretSpeech(e.text,name);
    for(const [owner,target] of [[recipient,e.speaker],[e.speaker,recipient]]){
      const existing=await ctx.db.query('relationshipChanges').withIndex('event',q=>q.eq('eventId',eventId).eq('owner',owner).eq('target',target)).unique();
      if(existing)continue;
      const recent=await ctx.db.query('relationshipChanges').withIndex('edge',q=>q.eq('worldId',e.worldId).eq('owner',owner).eq('target',target)).order('desc').take(20);
      const today=recent.filter(r=>r.occurredAt<=e.occurredAt&&e.occurredAt-r.occurredAt<86400000);
      const sources=await Promise.all(today.map(r=>ctx.db.get(r.eventId)));
      const active=today.filter((_,i)=>sources[i]&&!sources[i]!.inactive);
      const repetitive=sources.some(s=>s&&!s.inactive&&sameStatement(s.text,e.text));
      const rewardCount=active.filter(r=>r.kind===meaning?.kind).length;
      const delta=owner===recipient&&meaning&&!repetitive&&rewardCount<2?{...meaning.delta}:{};
      // Contact once per simulated wall-clock day; politeness cannot farm trust or affection.
      if(!active.length)Object.assign(delta,{familiarity:1});
      await ctx.db.insert('relationshipChanges',{worldId:e.worldId,owner,target,eventId,occurredAt:e.occurredAt,
        kind:meaning?.kind??'contact',sentiment:owner===recipient?(meaning?.sentiment??'Shared a direct conversation.'):'Expressed a social gesture; the other person’s response is not yet known.',delta});
    }
  }
}

export async function socialContext(ctx:{db:DatabaseReader},worldId:Id<'worlds'>,owner:string){
  const sheet=await ctx.db.query('characterSheets').withIndex('player',q=>q.eq('worldId',worldId).eq('playerId',owner)).unique();
  const baselines=await ctx.db.query('relationshipBaselines').withIndex('owner',q=>q.eq('worldId',worldId).eq('owner',owner)).take(12);
  const relationships=await Promise.all(baselines.map(async b=>{
    const changes=await ctx.db.query('relationshipChanges').withIndex('edge',q=>q.eq('worldId',worldId).eq('owner',owner).eq('target',b.target)).order('desc').take(100);
    const evidence=await Promise.all(changes.map(async c=>({change:c,event:await ctx.db.get(c.eventId)})));
    const active=evidence.filter((x):x is {change:Doc<'relationshipChanges'>;event:Doc<'memoryEvents'>}=>!!x.event&&!x.event.inactive&&x.event.witnesses.includes(owner));
    const scores=applyChanges(b.scores,active.slice().reverse().map(x=>x.change.delta));
    const latest=active[0];
    const incoming=latest&&latest.event.speaker!==owner&&Date.now()-latest.change.occurredAt<300000;
    const kind=incoming&&latest.change.kind!=='contact'?latest.change.kind:undefined;
    const choice=sheet?chooseIntention(sheet.traits,scores,kind):null;
    return {target:b.target,name:b.targetName,scores,description:describeRelationship(scores),backstory:b.story,choice,
      recent:active.slice(0,5).map(x=>({...x.change,evidence:x.event.text,context:x.event.context}))};
  }));
  return {sheet,relationships};
}
export function socialPrompt(social:Awaited<ReturnType<typeof socialContext>>,target?:string){
  if(!social.sheet)return '';
  const s=social.sheet;
  const relationships=(target?social.relationships.filter(r=>r.target===target):social.relationships).slice(0,3);
  return `\nYour stable values: ${s.values.join(', ')}. Your boundary: ${s.boundary}\nStress tendency (not a claim you are stressed now): ${s.stressResponse}\n`+
    relationships.map(r=>`Your view of ${r.name}: ${r.description} Authored history: ${r.backstory}\nPossible conversational intention: ${r.choice?.intent}. ${r.choice?.reason} Let the current topic and direct questions take priority; this is a tendency, not a script.\n${r.recent[0]?`Recent experience: ${r.recent[0].sentiment}`:''}`).join('\n');
}
