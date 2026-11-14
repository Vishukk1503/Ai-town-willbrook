import {repetitionFeedback} from '../convex/aiTown/repetitionFeedback';
import {parseLiveDialogue} from '../convex/aiTown/dialogueState';
import {buildJointContext,generateJointTurn} from '../convex/townJoint';
import {BobLuckyFlow} from '../convex/prototypes/bobLuckyFlow';
import {getFunctionName} from 'convex/server';
import {continueConversationMessage} from '../convex/agent/conversation';
import {parseGameId} from '../convex/aiTown/ids';

const repeated='The river was peaceful when I walked along its bank.';

test('feedback detects repeated sentences without rewriting history',()=>{
  const history=Object.freeze([repeated,'Aye. '+repeated]);
  expect(repetitionFeedback([...history])).toContain('You decide whether to continue or end');
  expect(history[1]).toBe('Aye. '+repeated);
});

test('no feedback on first turns, short acknowledgments, or new content',()=>{
  for(const history of [[],[repeated],['Thanks.','Thanks.'],[repeated,'Your garden looks lovely today.'],
    [repeated,repeated,'I prefer soup with a little pepper.']]) expect(repetitionFeedback(history)).toBe('');
});

test.each(['Bob','Lucky','Stella'])('%s can repeat or choose to end after advisory feedback',name=>{
  expect(repetitionFeedback([repeated,repeated])).not.toBe('');
  for(const continueConversation of [true,false]){
    const result=parseLiveDialogue(JSON.stringify({speech:repeated,intent:'share',continueConversation,
      topic:name,question:null,answersQuestion:false,proposal:null,response:'none',proposalId:null,
      privateConcern:null,eventReferences:[],boundary:null}));
    expect(result.dialogue.speech).toBe(repeated);
    expect(result.dialogue.continueConversation).toBe(continueConversation);
    expect(result.actionError).toBeUndefined();
  }
});

test.each(['Bob','Lucky'] as const)('%s receives feedback in existing calls and repeated speech still publishes',async name=>{
  const f=new BobLuckyFlow(),a=f.agent(name);
  a.inProgressOperation={name:'agentGenerateMessage',operationId:'repeat-test',started:f.now};
  const data=buildJointContext(f.game,a.id,f.conversationId!,f.now,
    [{author:a.playerId,text:repeated},{author:a.playerId,text:repeated}],[])!;
  const prompts:any[]=[],submissions:any[]=[];
  const oldFetch=globalThis.fetch;
  globalThis.fetch=(async(_url,options)=>{
    const request=JSON.parse(options!.body as string);prompts.push(request);
    return new Response(JSON.stringify({message:{content:prompts.length===1?
      JSON.stringify({choice:{kind:'conversation',action:'chat'},reason:'Keep talking'}):
      JSON.stringify({speech:repeated,proposedPlan:null})},prompt_eval_count:10,eval_count:10}),{status:200});
  }) as typeof fetch;
  const ctx:any={
    runQuery:async(ref:any)=>{
      const fn=getFunctionName(ref);
      if(fn==='townJoint:context')return data;
      if(fn==='modelSettings:plan')return {provider:'local',chosenModel:'test',maxTokens:1024};
      if(fn==='modelSettings:active'||fn==='townJoint:validatePlan')return true;
      throw Error(fn);
    },
    runMutation:async(ref:any,args:any)=>{
      const fn=getFunctionName(ref);
      if(fn==='modelSettings:reserve')return {id:'request'};
      if(fn==='modelSettings:finish')return;
      if(fn==='townJoint:submit'){submissions.push(args);return true;}
      throw Error(fn);
    },
  };
  try{await generateJointTurn(ctx,{worldId:f.game.worldId,agentId:a.id,conversationId:f.conversationId!,
    operationId:'repeat-test',messageUuid:'repeat-test',type:'continue'});}
  finally{globalThis.fetch=oldFetch;}
  expect(prompts).toHaveLength(2);
  for(const prompt of prompts)expect(JSON.stringify(prompt.messages)).toContain('your last reply appears to repeat');
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({speech:repeated,action:'chat'});
});

test('a partner repeating themselves does not trigger feedback for this resident',()=>{
  const f=new BobLuckyFlow(),a=f.agent('Bob'),partner=f.agent('Lucky');
  const data=buildJointContext(f.game,a.id,f.conversationId!,f.now,
    [{author:partner.playerId,text:repeated},{author:partner.playerId,text:repeated}],[])!;
  expect(data.state.repetitionFeedback).toBe('');
});

test.each(['Bob','Lucky','Stella'])('%s gets advisory feedback in the older town path with one call',async name=>{
  const history=[{author:'p:0',text:repeated},{author:'p:1',text:'Go on.'},{author:'p:0',text:repeated}];
  const prompts:any[]=[],oldFetch=globalThis.fetch;
  const raw=JSON.stringify({speech:repeated,intent:'share',continueConversation:true,
    topic:'river',question:null,answersQuestion:false,proposal:null,response:'none',proposalId:null,
    privateConcern:null,eventReferences:[],boundary:null});
  globalThis.fetch=(async(_url,options)=>{
    prompts.push(JSON.parse(options!.body as string));
    return new Response(JSON.stringify({message:{content:raw},prompt_eval_count:10,eval_count:10}),{status:200});
  }) as typeof fetch;
  const ctx:any={
    runQuery:async(ref:any)=>{
      const fn=getFunctionName(ref);
      if(fn==='agent/conversation:queryPromptData')return {
        player:{id:'p:0',name},otherPlayer:{id:'p:1',name:'Neighbor'},
        conversation:{id:'c:1',created:1000},agent:{identity:'A resident',plan:'Spend time together'},otherAgent:null};
      if(fn==='messages:listMessages')return history;
      if(fn==='modelSettings:plan')return {provider:'local',chosenModel:'test',maxTokens:1024};
      if(fn==='modelSettings:active')return true;
      throw Error(fn);
    },
    runMutation:async(ref:any)=>{
      const fn=getFunctionName(ref);
      if(fn==='modelSettings:reserve')return {id:'request'};
      if(fn==='modelSettings:finish')return;
      throw Error(fn);
    },
  };
  try{expect(await continueConversationMessage(ctx,'world' as any,
    parseGameId('conversations','c:1'),parseGameId('players','p:0'),parseGameId('players','p:1'),'reply')).toBe(raw);}
  finally{globalThis.fetch=oldFetch;}
  expect(prompts).toHaveLength(1);
  expect(JSON.stringify(prompts[0].messages)).toContain('your last reply appears to repeat');
});
