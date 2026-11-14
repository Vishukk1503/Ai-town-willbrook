import {characterContext} from '../data/characterContext';
import {actionMotiveIssue} from './aiTown/actionFacts';
import {reviewDialogue} from './aiTown/dialogueController';
import {initialDialogue,applyDialogue} from './aiTown/dialogueState';
import {getFunctionName} from 'convex/server';
import {agentGenerateMessage} from './aiTown/agentOperations';
import {characterContextInstructions} from '../data/characterContext';
import {actionFactInstructions} from './aiTown/actionFacts';
import {priorityActions} from './aiTown/physicalPriority';
import {actionSchema} from './aiTown/actionSchema';
import {query,internalAction,internalQuery} from './_generated/server';
import {v} from 'convex/values';
import {townContext} from './councilContext';
import {internal} from './_generated/api';
import {modelReply} from './modelReply';
import {buildActionMessages,buildActionContext} from './residentActions';
import {parseAction} from './aiTown/actionChoice';
import {dialogueInstructions,dialogueSchema,parseDialogue,farewell,groundingIssue} from './aiTown/dialogueState';
export const state=query({args:{},handler:async ctx=>{
  const status=await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();if(!status)return null;
  const turns=await ctx.db.query('dialogueTurns').withIndex('world',q=>q.eq('worldId',status.worldId)).order('desc').take(300);
  const descriptions=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',status.worldId)).collect();
  const names=Object.fromEntries(descriptions.map(p=>[p.playerId,p.name]));
  const requests=await ctx.db.query('modelRequests').order('desc').take(100);
  const timings=requests.filter(r=>r.scope==='town'&&r.status==='complete'&&r.ms!==undefined).map(r=>r.ms!).sort((a,b)=>a-b);
  const pairs:Record<string,{name:string;turns:number;endings:number}>={};
  for(const t of turns){const ids=[t.speaker,t.partner].sort(),key=ids.join('|');pairs[key]??={name:ids.map(id=>names[id]??'Resident').join(' / '),turns:0,endings:0};pairs[key].turns++;if(t.ended)pairs[key].endings++;}
  return {sample:turns.length,spoken:turns.filter(t=>t.status==='spoken').length,silent:turns.filter(t=>t.status==='silent').length,repetitionBlocks:turns.filter(t=>t.reason==='repetition').length,groundingBlocks:turns.filter(t=>['unknown_event_reference','unsupported_completed_action','unsupported_environment_detail'].includes(t.reason??'')).length,repairs:turns.filter(t=>!!t.repairReason).length,invalidOrProvider:turns.filter(t=>t.reason==='provider_or_invalid_output').length,endings:turns.filter(t=>t.ended&&t.status!=='blocked').length,medianMs:timings.length?timings[Math.floor(timings.length/2)]:null,pairs:Object.values(pairs)};
}});

// Bounded, explicitly synthetic regression scenes. No town messages, memories or actions are created.
export const probe=internalAction({args:{actor:v.union(v.literal('Bob'),v.literal('Stella'),v.literal('Lucky')),partner:v.union(v.literal('Bob'),v.literal('Stella'),v.literal('Lucky')),scene:v.union(v.literal('farewell'),v.literal('after_cooking'),v.literal('casual'))},handler:async(ctx,a)=>{
  const scene=a.scene==='farewell'?`Your visit is finished. ${a.partner} just said: "See you at dawn." There is no unanswered question or pending proposal. Finish naturally. No actual appointment has been scheduled.`:a.scene==='after_cooking'?`You and ${a.partner} just completed cooking a fish supper and each received one prepared portion. Neither person has eaten. Verified event: {"id":"life:probe-cook","kind":"cooking_agreement"}. ${a.partner} says: "That took longer than I expected. Still, I'm glad you stayed." React to their company in your own way. Do not arrange the same cooking again.`:`You and ${a.partner} are taking a quiet break. ${a.partner} says: "You don't have to fill every quiet moment, you know." No physical work or meal has happened. Respond naturally; silence is allowed.`;
  const result=await modelReply(ctx,{actor:a.actor,scope:'dialogue-validation',requestKey:`dialogue-probe:${crypto.randomUUID()}`,responseSchema:dialogueSchema,maxTokens:900,messages:[{role:'system',content:`You are ${a.actor}, speaking with ${a.partner}. This is an isolated synthetic regression scene; nothing is committed to the town. ${dialogueInstructions}`},{role:'user',content:scene}]});
  const decision=parseDialogue(result.content),issue=groundingIssue(decision,a.scene==='after_cooking'?[{id:'life:probe-cook',kind:'cooking_agreement'}]:[]);
  return {actor:a.actor,partner:a.partner,scene:a.scene,decision,issue:issue??null,ends:!decision.continueConversation||farewell(decision.speech),ms:result.ms};
}});

export const diagnostics=internalQuery({args:{scope:v.optional(v.string())},handler:async(ctx,a)=>{
  const requests=await ctx.db.query('modelRequests').order('desc').take(30);
  return requests.filter(r=>r.scope===(a.scope??'town')).slice(0,6).map(r=>({actor:r.actor,status:r.status,content:r.content,error:r.error,requestKey:r.key}));
}});

// Isolated transcript harness: normal provider/accounting, no world or memory writes.
export const transcriptProbe=internalAction({args:{actor:v.string(),scene:v.string(),transcript:v.array(v.object({speaker:v.string(),speech:v.string()}))},handler:async(ctx,a)=>{
 const state=await ctx.runQuery(internal.dialogueReview.probeCast,{});
 const actor=state.cast.find(p=>p.name===a.actor);if(!actor)throw new Error('Unknown resident');
 const result=await modelReply(ctx,{actor:a.actor,scope:'dialogue-validation',requestKey:'dialogue-transcript:'+crypto.randomUUID(),responseSchema:dialogueSchema,messages:[{role:'system',content:'You are '+actor.name+'. '+JSON.stringify(characterContext(actor.name,actor.persona,actor.plan))+'\nPersonal direction: '+actor.plan+'\n'+dialogueInstructions+'\nThis is an isolated synthetic dialogue test. The supplied scene overrides real inventories and memories for this scene only. No actions or memories will be committed. Available shared activities: none. Verified event IDs: none.'},{role:'user',content:a.scene+'\nTranscript so far:\n'+a.transcript.map(t=>t.speaker+': '+t.speech).join('\n')+'\nReply as '+a.actor+'. React to the last speaker. Do not speak for anyone else.'}]});
 const decision=parseDialogue(result.content),modelDecision=structuredClone(decision),history=initialDialogue();
 for(const t of a.transcript)applyDialogue(history,t.speaker,{speech:t.speech,intent:'share',continueConversation:true,topic:'',question:null,answersQuestion:false,proposal:null,response:'none',proposalId:null,privateConcern:null,eventReferences:[]});
 const issue=reviewDialogue(decision,history,a.actor,a.transcript.filter(t=>t.speaker===a.actor).map(t=>t.speech),[]);
 return {actor:a.actor,decision,modelDecision,issue:issue??null,ms:result.ms};
}});
export const probeCast=internalQuery({args:{},handler:async ctx=>{const t=await townContext(ctx);return {cast:t.cast};}});

// Admin-only controlled action evaluation. Uses the production prompt and parser,
// and normal billing, but never submits finishDecision or writes resident memory.
export const actionProbe=internalAction({args:{actor:v.string(),contextJson:v.string()},handler:async(ctx,a)=>{
 if(a.contextJson.length>30000)throw new Error('Probe context too large');
 const state=await ctx.runQuery(internal.dialogueReview.probeCast,{});
 const actor=state.cast.find(p=>p.name===a.actor);if(!actor)throw new Error('Unknown resident');
 const data={...JSON.parse(a.contextJson),name:actor.name,background:JSON.stringify(characterContext(actor.name,actor.persona,actor.plan)),plan:actor.plan} as NonNullable<Awaited<ReturnType<typeof buildActionContext>>>;
 if(!Array.isArray(data.options)||!data.options.length||data.options.length>40)throw new Error('Invalid probe menu');
 data.options=priorityActions(data.options,data.needs);
 const messages=buildActionMessages(data),requestKey='behavior-probe:'+crypto.randomUUID();
 const result=await modelReply(ctx,{actor:a.actor,scope:'action',requestKey,maxTokens:768,responseSchema:actionSchema(data.options),messages});
 let parsed=null,parseError=null;
 try{parsed=parseAction(result.content,data.options);}catch(e){parseError=e instanceof Error?e.message:'Invalid action';}
 return {actor:a.actor,requestKey,messages,raw:result.content,parsed,parseError,motiveIssue:parsed?actionMotiveIssue(parsed.reason,data.needs)??null:null,ms:result.ms};
}});

// Exercise the actual town prompt, provider call, repair loop and controller.
// Only provider accounting is forwarded; every world write is intercepted.
export const pipelineProbe=internalAction({args:{actor:v.string(),scene:v.string(),transcript:v.array(v.object({speaker:v.string(),speech:v.string()}))},handler:async(ctx,a)=>{
 const cast=(await ctx.runQuery(internal.dialogueReview.probeCast,{})).cast;
 const actor=cast.find(p=>p.name===a.actor),partner=cast.find(p=>p.name===a.transcript.at(-1)?.speaker);
 if(!actor||!partner||actor.name===partner.name)throw new Error('Invalid probe participants');
 const history=initialDialogue(),messages=a.transcript.map(t=>({author:cast.find(p=>p.name===t.speaker)?.playerId,text:t.speech}));
 for(const m of messages)applyDialogue(history,m.author??'',{speech:m.text,intent:'share',continueConversation:true,topic:'company',question:null,answersQuestion:false,proposal:null,response:'none',proposalId:null,privateConcern:null,eventReferences:[]});
 const promptData={player:{id:actor.playerId,name:actor.name},otherPlayer:{id:partner.playerId,name:partner.name},conversation:{id:'c:probe',created:Date.now(),dialogue:history},agent:{identity:JSON.stringify(characterContext(actor.name,actor.persona,actor.plan))+characterContextInstructions+actionFactInstructions+'\nSYNTHETIC VERIFIED SCENE: '+a.scene+'\nNo verified completed events. Available shared activities: none. Conversation state: '+JSON.stringify(history),plan:actor.plan},otherAgent:{identity:'',plan:''},lastConversation:null,inventory:{fish:0,meals:0,turnips:0},verifiedFacts:[],activityInvitations:[],activeWorldClock:0};
 let captured:unknown=null;const started=Date.now();
 const isolated={...ctx,runQuery:async(ref:any,args:any)=>{
  const name=getFunctionName(ref);
  if(name==='agent/conversation:queryPromptData')return promptData;
  if(name==='messages:listMessages')return messages;
  if(name==='modelSettings:active')return true;
  if(name==='modelSettings:plan')return ctx.runQuery(ref,args);
  throw new Error('Unexpected probe read: '+name);
 },runMutation:async(ref:any,args:any)=>{
  const name=getFunctionName(ref);
  if(name==='aiTown/agent:agentSendMessage'){captured=args;return null;}
  if(['modelSettings:reserve','modelSettings:finish'].includes(name))return ctx.runMutation(ref,args);
  throw new Error('Probe blocked world write: '+name);
 }};
 await (agentGenerateMessage as any)._handler(isolated,{worldId:'synthetic-world',conversationId:'c:probe',agentId:'a:probe',playerId:actor.playerId,otherPlayerId:partner.playerId,operationId:'pipeline-probe:'+crypto.randomUUID(),type:'continue',messageUuid:crypto.randomUUID()});
 return {actor:a.actor,captured,ms:Date.now()-started};
}});
