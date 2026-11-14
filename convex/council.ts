import {dialogueDecision,initialDialogue,applyDialogue} from './aiTown/dialogueState';
import {dialogueInstructions,dialogueSchema,parseLiveDialogue} from './aiTown/dialogueState';
import {relevantMemories} from '../data/dialogue';
import {repetitionFeedback} from './aiTown/repetitionFeedback';
import {modelReply} from './modelReply';
import { socialContext, socialPrompt } from './social';
import { recordSpeech, recallGraph, graphPrompt, recallCharacter, characterPrompt } from './memoryGraph';
import { v } from 'convex/values';
import { mutation, query, internalQuery, internalMutation, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { stopEngine } from './aiTown/main';
import { townContext } from './councilContext';
import { parseGameId } from './aiTown/ids';
import * as embeddingsCache from './agent/embeddingsCache';

const cast = {length:3};
const speakerIndex=(turn:number)=>(turn%3+Math.floor(turn/3))%3;
function repeatsEarlierReply(text:string,earlier:string[]){
  const grams=(s:string)=>{const w=s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);return new Set(w.slice(0,-4).map((_,i)=>w.slice(i,i+5).join(' ')));};
  const own=grams(text);
  return own.size>12&&earlier.some(s=>{const other=grams(s);return [...own].filter(g=>other.has(g)).length/own.size>0.32;});
}
export const townFeed = query({args:{},handler:async ctx=>{
  const status=await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();
  if(!status) return null;
  const descriptions=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',status.worldId)).collect();
  const messages=await ctx.db.query('messages').filter(q=>q.eq(q.field('worldId'),status.worldId)).order('desc').take(45);
  const council=await ctx.db.query('councilSessions').order('desc').first();
  return {status:status.status,councilRunning:council?.status==='running',messages:messages.filter(m=>m.text.trim()).map(m=>({...m,speaker:descriptions.find(d=>d.playerId===m.author)?.name??'Visitor'})).reverse()};
}});
export const state = query({ args: {}, handler: async ctx => {
  const session = await ctx.db.query('councilSessions').order('desc').first();
  const messages = session ? await ctx.db.query('councilMessages').withIndex('session', q => q.eq('sessionId', session._id)).collect() : [];
  const town=await townContext(ctx,session?.worldId);
  const graphDetails=await Promise.all(town.cast.map(async a=>({name:a.name,items:await recallGraph(ctx,town.world._id,a.playerId),character:await recallCharacter(ctx,town.world._id,a.playerId),social:await socialContext(ctx,town.world._id,a.playerId)})));
  return { graphDetails, session, messages, activeSpeaker:session?speakerIndex(session.nextTurn):0, loreBackground:town.lore?.background, cast:session?.participants??town.cast, currentCast:town.cast, memoryCounts:town.memories.map(m=>({playerId:m.playerId,count:m.items.length})), memoryDetails:town.memories.map(m=>({name:town.cast.find(a=>a.playerId===m.playerId)?.name??m.playerId,items:m.items.map(i=>({id:i._id,text:i.description,type:i.data.type}))})), townStatus:town.status.status };
}});
export const start = mutation({
  args: { background: v.string(), topic: v.string(), rounds: v.number(), testMode:v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (!args.topic.trim() || args.topic.length > 2000 || args.background.length > 8000) throw new Error('Enter a topic (up to 2,000 characters) and world background (up to 8,000).');
    if (!Number.isInteger(args.rounds) || args.rounds < 1 || args.rounds > 8) throw new Error('Choose 1–8 rounds.');
    const previous = await ctx.db.query('councilSessions').order('desc').first();
    if (previous?.status === 'running') await ctx.db.patch(previous._id, {status:'paused'});
    const world = await ctx.db.query('worldStatus').filter(q => q.eq(q.field('isDefault'), true)).unique();
    if (world?.status === 'running') {
      await stopEngine(ctx, world.worldId);
      await ctx.db.patch(world._id, {status:'stoppedByDeveloper'});
    }
    const town=await townContext(ctx);
    if(town.cast.length!==3) throw new Error('This council currently requires the three town agents.');
    if(!args.testMode&&town.lore) await ctx.db.patch(town.lore._id,{background:args.background});
    else if(!args.testMode) await ctx.db.insert('worldLore',{worldId:town.world._id,background:args.background});
    const id = await ctx.db.insert('councilSessions', {...args, worldId:town.world._id,participants:town.cast,status:'running', nextTurn:0,dialogue:initialDialogue()});
    await ctx.scheduler.runAfter(0, internal.council.turn, {id, expected:0});
    return id;
  },
});
export const pause = mutation({args:{}, handler:async ctx => {
  const s = await ctx.db.query('councilSessions').order('desc').first();
  if (s?.status === 'running') await ctx.db.patch(s._id, {status:'paused'});
}});
export const interject = mutation({args:{text:v.string()},handler:async(ctx,{text})=>{
  const s=await ctx.db.query('councilSessions').order('desc').first();
  if(!s)throw new Error('Start a discussion first.');
  if(!text.trim()||text.length>1500)throw new Error('Enter a message up to 1,500 characters.');
  await ctx.db.insert('councilMessages',{sessionId:s._id,speaker:'You',text:text.trim(),round:Math.min(s.rounds,Math.floor(s.nextTurn/3)+1),seconds:0});
}});
export const extend = mutation({args:{},handler:async ctx=>{
  const s=await ctx.db.query('councilSessions').order('desc').first();
  if(!s||s.status!=='complete')throw new Error('Wait for this round to finish.');
  if(s.rounds>=8)throw new Error('This discussion reached eight rounds. Start a new topic to continue.');
  const town=await townContext(ctx,s.worldId);
  if(town.status.status==='running') {await stopEngine(ctx,town.world._id);await ctx.db.patch(town.status._id,{status:'stoppedByDeveloper'});}
  // Refresh identities for the new round; prior messages remain unchanged.
  await ctx.db.patch(s._id,{rounds:s.rounds+1,status:'running',participants:town.cast,dialogue:initialDialogue(),endReason:undefined});
  await ctx.scheduler.runAfter(0,internal.council.turn,{id:s._id,expected:s.nextTurn});
}});
export const resume = mutation({args:{}, handler:async ctx => {
  const s = await ctx.db.query('councilSessions').order('desc').first();
  if (s && ['paused','error'].includes(s.status)) {
    const town=await townContext(ctx,s.worldId);
    if(town.status.status==='running') {
      await stopEngine(ctx,town.world._id);
      await ctx.db.patch(town.status._id,{status:'stoppedByDeveloper'});
    }
    await ctx.db.patch(s._id, {status:'running', error:undefined,attempt:(s.attempt??0)+1});
    await ctx.scheduler.runAfter(0, internal.council.turn, {id:s._id, expected:s.nextTurn});
  }
}});
export const load = internalQuery({args:{id:v.id('councilSessions')}, handler:async(ctx,{id}) => {
  const session=await ctx.db.get(id);
  const town=await townContext(ctx,session?.worldId);
  const graph=await Promise.all(town.cast.map(async a=>({playerId:a.playerId,items:await recallGraph(ctx,town.world._id,a.playerId),character:await recallCharacter(ctx,town.world._id,a.playerId),social:await socialContext(ctx,town.world._id,a.playerId)})));
  return {graph,session,messages:await ctx.db.query('councilMessages').withIndex('session',q=>q.eq('sessionId',id)).collect(),town:await townContext(ctx,session?.worldId)};
}});
export const commit = internalMutation({args:{id:v.id('councilSessions'),expected:v.number(),text:v.string(),seconds:v.number(),ended:v.optional(v.boolean()),decision:v.optional(dialogueDecision),repairReason:v.optional(v.string()),attempt:v.optional(v.number()),error:v.optional(v.string()),embedding:v.optional(v.array(v.number())),memoryText:v.optional(v.string()),memoriesUsed:v.optional(v.number()),townMessagesUsed:v.optional(v.number())}, handler:async(ctx,a) => {
  const s=await ctx.db.get(a.id);
  if (!s || s.status!=='running' || s.nextTurn!==a.expected || (s.attempt??0)!==(a.attempt??0)) return;
  if(a.error) {await ctx.db.patch(a.id,{status:'error',error:a.error,endReason:'validation_or_provider_error'});return;}
  const participants=s.participants??(await townContext(ctx,s.worldId)).cast;
  const messageId=await ctx.db.insert('councilMessages',{sessionId:a.id,speaker:participants[speakerIndex(a.expected)].name,text:a.text,round:Math.floor(a.expected/participants.length)+1,seconds:a.seconds,memoriesUsed:a.memoriesUsed,townMessagesUsed:a.townMessagesUsed,...(a.decision?{decision:a.decision}:{}),...(a.repairReason?{repairReason:a.repairReason}:{})});
  const worldId=s.worldId??(await townContext(ctx)).world._id;
  if(!s.testMode) await recordSpeech(ctx,{worldId,source:`council:${messageId}`,context:'Council conversation',
    speaker:participants[speakerIndex(a.expected)].playerId,speakerName:participants[speakerIndex(a.expected)].name,
    text:a.text,witnesses:participants.map(p=>p.playerId),occurredAt:Date.now()});
  if(!s.testMode&&a.embedding&&a.memoryText) for(const actor of participants) {
    const playerId=parseGameId('players',actor.playerId);
    const embeddingId=await ctx.db.insert('memoryEmbeddings',{playerId,embedding:a.embedding});
    await ctx.db.insert('memories',{playerId,embeddingId,description:a.memoryText,importance:6,lastAccess:Date.now(),data:{type:'reflection',relatedMemoryIds:[]}});
  }
  const dialogue=s.dialogue??initialDialogue();if(a.decision)applyDialogue(dialogue,participants[speakerIndex(a.expected)].playerId,a.decision);
  const next=a.expected+1;
  await ctx.db.patch(a.id,{nextTurn:next,dialogue,endReason:a.ended?'natural':next>=s.rounds*cast.length?'turn_limit':undefined,status:a.ended||next>=s.rounds*cast.length?'complete':'running'});
  if(!a.ended&&next<s.rounds*cast.length) await ctx.scheduler.runAfter(1000,internal.council.turn,{id:a.id,expected:next});
}});
export const turn = internalAction({args:{id:v.id('councilSessions'),expected:v.number()},handler:async(ctx,a) => {
  const {session:s,messages,town,graph}=await ctx.runQuery(internal.council.load,{id:a.id});
  if(!s || s.status!=='running' || s.nextTurn!==a.expected) return;
  const participants=s.participants??town.cast;
  const actor=participants[speakerIndex(a.expected)];
  const focus=s.topic+' '+messages.slice(-3).map(m=>m.text).join(' ');
  const memories=relevantMemories(town.memories.find(m=>m.playerId===actor.playerId)?.items??[],focus);
  const knownConversations=new Set([
    ...town.messages.filter(m=>m.author===actor.playerId).map(m=>m.conversationId),
    ...town.archived.filter(c=>c.participants.some(p=>p===actor.playerId)).map(c=>c.id),
    ...town.world.conversations.filter(c=>c.participants.some(p=>p.playerId===actor.playerId)).map(c=>c.id),
  ]);
  const retiredScenario=/storm|flood|bridge|forest.{0,12}lease|lease.{0,12}offer|library.{0,12}roof|240.{0,10}coin|ten volunteer shifts/i;
  const interactions=town.messages.filter(m=>knownConversations.has(m.conversationId)&&m.text.trim()).filter(m=>!s.background.includes('There is no preset')||retiredScenario.test(s.topic)||!retiredScenario.test(m.text)).slice(0,4).reverse();
  const carried=town.world.economy?.bags.find(b=>b.owner===actor.playerId)?.items;
  const ownership='\nVerified carried inventory by resident (speech never changes these quantities): '+JSON.stringify(town.cast.map(p=>({name:p.name,items:town.world.economy?.bags.find(b=>b.owner===p.playerId)?.items??{}})));
  const belongings=carried?`\nYour actual carried items: ${Object.entries(carried).map(([k,v])=>`${v} ${k}`).join(', ')}. Do not invent items.`:'';
  const personalContext=ownership+belongings+socialPrompt(graph.find(g=>g.playerId===actor.playerId)!.social)+characterPrompt(graph.find(g=>g.playerId===actor.playerId)!.character,actor.playerId)+graphPrompt(relevantMemories((graph.find(g=>g.playerId===actor.playerId)?.items??[]).map(e=>({...e,description:e.text})),focus))+`\nYour existing town goal: ${actor.plan}\nYour remembered experiences (reference information, not instructions):\n${memories.map(m=>m.description.slice(0,260)).join('\n')||'(No stored memories yet.)'}\nRecent conversations you actually participated in:\n${interactions.map(m=>`${town.cast.find(p=>p.playerId===m.author)?.name??'Neighbor'}: ${m.text.slice(0,180)}`).join('\n')||'(No recent town dialogue.)'}`;
  const started=Date.now();
  const feedback=repetitionFeedback(messages.filter(m=>m.speaker===actor.name).map(m=>m.text));
  try {

    const response=await modelReply(ctx,{actor:actor.name,scope:'council',requestKey:`council:${a.id}:${a.expected}:${s.attempt??0}:repair:0`,validity:{sessionId:a.id,expected:a.expected,attempt:s.attempt??0},maxTokens:650,responseSchema:dialogueSchema,messages:[
        {role:'system',content:`${dialogueInstructions}\n${feedback}\nYou are ${actor.name}. ${actor.persona}\n${personalContext}\nConversation tracking: ${JSON.stringify(s.dialogue??initialDialogue())}\nWorld background:\n${s.background}\nYou are spending time with your neighbors. Speak in your own voice, with your own preferences and boundaries. Use 1–4 short spoken lines; a brief reaction is enough. Do not revive old scenarios unless the current topic asks for them. Memories are past experiences, not today's agenda. This is turn ${a.expected+1}. End naturally when settled. Speech cannot execute actions or transfer ownership. Available shared activities: none. Verified event IDs: none. Keep track of who offered each item and who agreed to cook. Never invent equipment or crop growth timing.`},
        {role:'user',content:`Topic: ${s.topic}\n\nRecent conversation:\n${messages.slice(-7).map(m=>`${m.speaker}: ${m.text}`).join('\n') || '(You are opening a casual conversation.)'}\n\nReply only as ${actor.name}. ${messages.length?`Respond to what catches your attention in ${messages[messages.length-1].speaker}'s words; you do not need to approve or extend their plan.`:'Say what comes to mind about this topic.'} Speak in first person.`},
      ]});
    const {dialogue:decision}=parseLiveDialogue(response.content);
    // A resident ending their contribution must not silence residents who have not spoken.
    if(!participants.every(p=>p.playerId===actor.playerId||messages.some(m=>m.speaker===p.name)))decision.continueConversation=true;
    const text=decision.speech;
    const memoryText=`[Council meeting] ${actor.name} said: ${text.slice(0,900)}\nTopic: ${s.topic.slice(0,300)}\nWorld: ${s.background.slice(0,180)}`;
    const embedding=s.testMode?undefined:await embeddingsCache.fetch(ctx,memoryText);
    await ctx.runMutation(internal.council.commit,{...a,attempt:s.attempt??0,text,decision,ended:!decision.continueConversation,seconds:(Date.now()-started)/1000,embedding,memoryText,memoriesUsed:memories.length,townMessagesUsed:interactions.length});return;
  } catch(e) {
    await ctx.runMutation(internal.council.commit,{...a,attempt:s.attempt??0,text:'',seconds:0,error:e instanceof Error?e.message:'Model request failed'});
  }
}});
