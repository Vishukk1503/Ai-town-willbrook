// Admin-only evaluation: real provider accounting, isolated copies of town state.
// No world, message, memory or scheduling writes leave this harness.
import { v } from 'convex/values';
import { getFunctionName } from 'convex/server';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { Game } from './aiTown/game';
import { Conversation } from './aiTown/conversation';
import { jointContext } from './aiTown/jointConversation';
import { validateSteps } from './aiTown/planActions';
import { decodePlan, parseReview, reviewSchema, reviewBasis } from './aiTown/jointThreeStage';
import { buildJointContext, comparisonInstructions, comparisonPacket, generateJointTurn, loadTownGame } from './townJoint';
import { modelReply } from './modelReply';

function pack(game: Game, now: number, history: any[], memories: any[]) {
  return {engine: game.engine, worldId: game.worldId, now, history, memories,
    state: {world: game.world.serialize(), worldMap: game.worldMap.serialize(),
      playerDescriptions: [...game.playerDescriptions.values()].map(p => p.serialize()),
      agentDescriptions: [...game.agentDescriptions.values()].map(p => p.serialize())}};
}
export const snapshot = internalQuery({args:{worldId:v.id('worlds')}, handler:async(ctx,a)=>{
  const {game}=await loadTownGame(ctx.db,a.worldId);
  const history=await ctx.db.query('messages').filter(q=>q.eq(q.field('worldId'),a.worldId)).order('desc').take(100);
  const memories=[];
  for(const agent of game.world.agents.values()) {
    if(!['Bob','Lucky'].includes(game.playerDescriptions.get(agent.playerId)?.name??'')) continue;
    memories.push(...await ctx.db.query('memories').withIndex('playerId',q=>q.eq('playerId',agent.playerId)).filter(q=>q.neq(q.field('inactive'),true)).order('desc').take(3));
  }
  const now=game.engine.currentTime??Date.now();
  return pack(game,now,history.reverse(),memories);
}});
export const requests = internalQuery({args:{prefix:v.string()}, handler:async(ctx,a)=>{
  // Exact prefix keys are intentionally bounded to this evaluation's requests.
  const rows=await ctx.db.query('modelRequests').order('desc').take(500);
  return rows.filter(r=>r.key.startsWith(a.prefix));
}});
export const saved = internalAction({args:{test:v.any(),runId:v.string()},handler:async(ctx,a):Promise<any>=>{
  const t=a.test, start=Date.now();
  if(!['Bob','Lucky'].includes(t.context.actor)) throw Error('Bob/Lucky only');
  let plan;
  try {plan=decodePlan(JSON.stringify(t.plan),t.context.options.map((o:any)=>o.id),t.context.state.catalogue.townActions);}
  catch(e){return {id:t.id,rejected:true,engineError:String(e),ms:Date.now()-start,calls:0};}
  const key=`comparison-saved:${a.runId}:${t.id}`;
  const result=await modelReply(ctx,{actor:t.context.actor,scope:'town-joint-review',requestKey:key,outputContract:'intent',maxTokens:1024,responseSchema:reviewSchema,
    messages:[{role:'system',content:comparisonInstructions},{role:'user',content:JSON.stringify(comparisonPacket(t.context,plan,t.speech))}]});
  let review=null,error=null;
  try {review=parseReview(result.content,t.speech,plan.selected.length);}catch(e){error=String(e);}
  return {id:t.id,rejected:!!error||!review?.approved,review,error,raw:result.content,ms:Date.now()-start,calls:1,requests:await ctx.runQuery(internal.bobLuckyComparisonTest.requests,{prefix:key})};
}});

export const turn = internalAction({args:{snapshot:v.any(),runId:v.string(),index:v.number(),observeOnly:v.optional(v.boolean())},handler:async(ctx,a):Promise<any>=>{
  const s=a.snapshot,game=new Game(s.engine,s.worldId,s.state);
  let now=s.now, pending:any=null;
  const history=s.history, start=Date.now(), audit:any[]=[];
  const names=new Map([...game.playerDescriptions.values()].map(p=>[p.playerId,p.name]));
  const actors=[...game.world.agents.values()].filter(x=>['Bob','Lucky'].includes(names.get(x.playerId)??''));
  if(actors.length!==2)throw Error('Bob/Lucky missing');
  const isPair=(id:string)=>{
    const c=game.world.conversations.get(id as any);
    return !!c&&actors.every(x=>c.participants.has(x.playerId));
  };
  const active=()=>actors.some(x=>x.sleep||x.spokenPlan&&!['done','interrupted'].includes(x.spokenPlan.state));
  const sample=()=>actors.map(x=>({actor:names.get(x.playerId),position:{...game.world.players.get(x.playerId)!.position},plan:x.spokenPlan??null,sleep:x.sleep??null,decision:x.decision??null,inventory:game.world.economy?.bags.find(b=>b.owner===x.playerId)?.items,needs:game.world.livelihood?.needs.find(n=>n.owner===x.playerId)}));
  const drain=()=>{
    for(const op of game.pendingOperations){
      const agent=game.world.agents.get(op.args.agentId);
      if(op.name==='agentGenerateMessage'&&isPair(op.args.conversationId)&&!pending){pending=op.args;continue;}
      if(agent && agent.inProgressOperation?.operationId===op.args.operationId){delete agent.inProgressOperation;agent.nextDecisionAt=now+60000;}
      if(agent && agent.memoryOperation?.operationId===op.args.operationId)delete agent.memoryOperation;
    }
    game.pendingOperations=[];
  };
  // Resume the pending model operation serialized by the preceding evaluation turn.
  for(const x of actors)if(x.inProgressOperation?.name==='agentGenerateMessage'){
    const c=game.world.playerConversation(game.world.players.get(x.playerId)!);
    if(c&&isPair(c.id))pending={worldId:game.worldId,agentId:x.id,conversationId:c.id,operationId:x.inProgressOperation.operationId,messageUuid:crypto.randomUUID(),type:'continue'};
  }
  if(!a.observeOnly){
    for(let i=0;!pending&&i<12000;i++){
      const paired=[...game.world.conversations.values()].some(c=>isPair(c.id));
      if(!paired&&!active()&&actors.every(x=>!game.world.playerConversation(game.world.players.get(x.playerId)!))){
        const [p,q]=actors.map(x=>game.world.players.get(x.playerId)!);
        const c=Conversation.start(game,now,a.index%2?p:q,a.index%2?q:p);
        if(c.conversationId)game.world.conversations.get(c.conversationId)!.acceptInvite(game,a.index%2?q:p);
      }
      now+=100;game.numPathfinds=0;game.tick(now);drain();
      if(i%100===0) audit.push({at:now,state:sample()});
    }
    if(!pending)throw Error('No Bob/Lucky turn after 20 simulation minutes; no model called');
  }
  let data:any=null,submitted:any=null,failure:any=null;
  if(!a.observeOnly){
    const args={...pending,operationId:`comparison-${a.runId}-${a.index}`,messageUuid:`comparison-${a.runId}-${a.index}`};
    const agent=game.world.agents.get(args.agentId)!;
    agent.inProgressOperation={name:'agentGenerateMessage',operationId:args.operationId,started:now};
    data=buildJointContext(game,args.agentId,args.conversationId,now,history.filter((m:any)=>m.conversationId===args.conversationId),s.memories.filter((m:any)=>m.playerId===agent.playerId));
    const isolated={...ctx,
      runQuery:async(ref:any,params:any)=>{
        const name=getFunctionName(ref);
        if(name==='townJoint:context')return data;
        if(name==='townJoint:validatePlan'){
          const x=jointContext(game,args.agentId,args.conversationId,now)!;
          if(params.basis!==reviewBasis(game,x.a)||!x.options.some(o=>o.id===params.action))return false;
          if(params.action==='plan')validateSteps(game,x.a,params.steps,now);
          else if(params.steps.length)return false;
          return true;
        }
        if(name.startsWith('modelSettings:'))return ctx.runQuery(ref,params);
        throw Error('Unexpected evaluation query '+name);
      },
      runMutation:async(ref:any,params:any)=>{
        const name=getFunctionName(ref);
        if(name.startsWith('modelSettings:'))return ctx.runMutation(ref,params);
        if(name==='townJoint:submit'){
          submitted=params;
          const {worldId,reviewAttempt,...input}=params;
          game.handleInput(now,'finishJointTurn',input);
          return game.jointMessages.some(m=>m.operationId===args.operationId);
        }
        if(name==='townJoint:fail'){
          failure=params.reason;
          game.handleInput(now,'failedDialogue',{agentId:params.agentId,operationId:params.operationId,reason:params.reason});
          return null;
        }
        throw Error('Unexpected evaluation write '+name);
      }};
    await generateJointTurn(isolated as any,args,true);
    for(const m of game.jointMessages)history.push({conversationId:m.conversationId,author:m.playerId,text:m.text});
    pending=null;
  }
  const modelMs=Date.now()-start;
  // Advance the real engine until another model turn is needed or all plans resolve.
  // Never fake a partner's acknowledgment or consent to complete a test.
  for(let i=0;i<12000;i++){
    now+=100;game.numPathfinds=0;game.tick(now);drain();
    if(i%100===0)audit.push({at:now,state:sample()});
    if(pending||!active()&&![...game.world.conversations.values()].some(c=>isPair(c.id)))break;
  }
  return {actor:data?.actor??null,context:data,submitted,failure,modelMs,totalMs:Date.now()-start,
    messages:game.jointMessages,events:game.decisionEvents,audit,final:sample(),pending,
    snapshot:pack(game,now,history,s.memories),requests:await ctx.runQuery(internal.bobLuckyComparisonTest.requests,{prefix:`town-joint:comparison-${a.runId}-${a.index}:`})};
}});
