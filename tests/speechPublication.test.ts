import {parseLiveDialogue, initialDialogue, applyDialogue} from '../convex/aiTown/dialogueState';
import {threeStage} from '../convex/aiTown/jointThreeStage';
import {BobLuckyFlow} from '../convex/prototypes/bobLuckyFlow';
import {buildJointContext,generateJointTurn} from '../convex/townJoint';
import {getFunctionName} from 'convex/server';

const draft=(speech:string,extra:Record<string,unknown>={})=>JSON.stringify({
  speech,intent:'share',continueConversation:true,topic:'garden',question:null,
  answersQuestion:false,proposal:null,response:'none',proposalId:null,
  privateConcern:null,eventReferences:[],boundary:null,...extra,
});

test.each(['Bob','Lucky','Stella'])('%s keeps their words despite old speech heuristics',name=>{
  for(const words of ["I'll water the garden tomorrow.", 'I can give five fish.',
    'It rained last week.', 'Aye, thanks.', "I'll head home.", 'Leave me alone.',
    'My own longer thought. '.repeat(40)]){
    const {dialogue,actionError}=parseLiveDialogue(draft(words));
    const state=initialDialogue();applyDialogue(state,name,dialogue);
    expect(dialogue.speech).toBe(words);
    expect(dialogue.continueConversation).toBe(true);
    expect(actionError).toBeUndefined();
    expect(state.boundary).toBeUndefined();
  }
});

test('invalid activity metadata is dropped while original speech and continuation survive',()=>{
  const speech='Let us build a mill; what do you think?';
  const {dialogue,actionError}=parseLiveDialogue(draft(speech,{proposal:{activity:'build',delayMinutes:-5}}));
  expect(actionError).toBeDefined();expect(dialogue.proposal).toBeNull();
  expect(dialogue.speech).toBe(speech);expect(dialogue.continueConversation).toBe(true);
});

test('the model can still choose silence or end explicitly',()=>{
  expect(parseLiveDialogue(draft('',{intent:'silence'})).dialogue.intent).toBe('silence');
  expect(parseLiveDialogue(draft('Enough for now.',{continueConversation:false})).dialogue.continueConversation).toBe(false);
});

test.each([false,true])('action validation failure retains speech (replacement=%s)',async replacement=>{
  const calls:string[]=[],committed:any[]=[];
  const fallback={selected:[],action:'chat'};
  await threeStage({
    choose:async()=>{calls.push('choose');return replacement?'valid':'invalid';},
    validate:async raw=>{if(raw.includes('invalid'))throw Error('Missing inventory');return {selected:[{}],action:'plan'};},
    onInvalidAction:()=>fallback,
    speak:async()=>{calls.push('speak');return JSON.stringify({speech:'My own words.',proposedPlan:replacement?{invalid:true}:null});},
    commit:async(plan,speech)=>{committed.push({plan,speech});},
  });
  expect(calls).toEqual(['choose','speak']);
  expect(committed).toEqual([{plan:fallback,speech:'My own words.'}]);
});

test('live Bob-Lucky generation still reaches publication when the chosen action is invalid',async()=>{
  const f=new BobLuckyFlow(),a=f.agent('Lucky');
  a.inProgressOperation={name:'agentGenerateMessage',operationId:'saved-turn',started:f.now};
  const data=buildJointContext(f.game,a.id,f.conversationId!,f.now,[],[]);
  const submissions:any[]=[],stages:string[]=[];
  const speech='I thought I had supper packed. Tell me about your day.';
  const ctx:any={
    runQuery:async(ref:any)=>{
      const name=getFunctionName(ref);
      if(name==='townJoint:context')return data;
      if(name==='modelSettings:plan')return {provider:'local',chosenModel:'saved',maxTokens:1024};
      if(name==='modelSettings:active')return true;
      throw Error('Unexpected query '+name);
    },
    runMutation:async(ref:any,args:any)=>{
      const name=getFunctionName(ref);
      if(name==='modelSettings:reserve'){
        const stage=args.key.includes(':choose:')?'choose':'speak';stages.push(stage);
        return {existing:{status:'complete',content:stage==='choose'?
          JSON.stringify({choice:{kind:'actions',steps:[{action:'build_castle',durationMinutes:4}]},reason:'Try building'}):
          JSON.stringify({speech,proposedPlan:null})}};
      }
      if(name==='townJoint:submit'){submissions.push(args);return true;}
      throw Error('Unexpected mutation '+name);
    },
  };
  await generateJointTurn(ctx,{worldId:f.game.worldId,agentId:a.id,conversationId:f.conversationId!,
    operationId:'saved-turn',messageUuid:'saved-turn',type:'continue'});
  expect(stages).toEqual(['choose','speak']);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({speech,action:'chat',steps:[]});
});

test.each(['Bob','Lucky','Stella'])('%s keeps the encounter after an unavailable shared action',name=>{
  const f=new BobLuckyFlow(),a=f.agent('Lucky');
  f.game.playerDescriptions.get(a.playerId)!.name=name;
  a.inProgressOperation={name:'agentGenerateMessage',operationId:'speech',started:f.now};
  const {dialogue}=parseLiveDialogue(draft('Let us eat together.',{
    proposal:{activity:'meal',placeId:'nonexistent',delayMinutes:0,destinationId:null},
    response:'accept',proposalId:98765,
  }));
  const before=JSON.stringify(f.game.world.economy!.bags);
  f.game.handleInput(f.now,'agentFinishSendingMessage',{
    agentId:a.id,conversationId:f.conversationId!,operationId:'speech',timestamp:f.now,
    leaveConversation:false,dialogue,
  });
  expect(f.game.world.conversations.get(f.conversationId!)?.numMessages).toBe(1);
  expect(a.inProgressOperation).toBeUndefined();
  expect(JSON.stringify(f.game.world.economy!.bags)).toBe(before);
  expect(f.game.world.livelihood!.activities??[]).toHaveLength(0);
});

test.each(['Bob','Lucky'] as const)('%s publishes despite an invalid physical plan and can hear a reply',name=>{
  const f=new BobLuckyFlow(),a=f.agent(name),c=f.game.world.conversations.get(f.conversationId!)!;
  a.inProgressOperation={name:'agentGenerateMessage',operationId:'speech',started:f.now};
  const before=JSON.stringify(f.game.world.economy!.bags);
  f.game.handleInput(f.now,'finishJointTurn',{
    agentId:a.id,conversationId:c.id,operationId:'speech',messageUuid:'speech',expectedMessages:0,
    speech:'I could eat with you. What were you saying?',action:'plan',
    steps:[{action:'eat',target:'eat:meals',durationMinutes:null}],invitation:null,reason:'Hungry',
  });
  expect(f.game.jointMessages[0]?.text).toBe('I could eat with you. What were you saying?');
  expect(f.game.jointMessages[0]?.ended).toBe(false);
  expect(a.spokenPlan).toBeUndefined();
  expect(JSON.stringify(f.game.world.economy!.bags)).toBe(before);
  expect(c.numMessages).toBe(1);expect(c.isTyping).toBeUndefined();
  expect(f.game.world.conversations.has(c.id)).toBe(true);
});
