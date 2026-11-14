import {behaviorFixture} from './behaviorFixture';
import {availableActions,parseAction} from '../convex/aiTown/actionChoice';
import {actionSchema} from '../convex/aiTown/actionSchema';
import {requestModel} from '../convex/util/modelTransport';
import {agentInputs} from '../convex/aiTown/agentInputs';
import {Agent} from '../convex/aiTown/agent';
import {Conversation} from '../convex/aiTown/conversation';
import {initialAwareness} from '../convex/aiTown/awareness';
import {boundaryFromSpeech,rememberBoundary,blocksContact} from '../convex/aiTown/socialBoundary';
import {parseDialogue,initialDialogue,applyDialogue} from '../convex/aiTown/dialogueState';
import {reviewDialogue} from '../convex/aiTown/dialogueController';
import {characterContext} from '../data/characterContext';
import {actionFacts,actionMotiveIssue} from '../convex/aiTown/actionFacts';
import {WORLD_HOUR_MS} from '../data/worldTime';
const reply=(speech:string)=>parseDialogue(JSON.stringify({speech,intent:'share',continueConversation:true,topic:'company',question:null,answersQuestion:false,proposal:null,response:'none',proposalId:null,privateConcern:null,eventReferences:[]}));
const choose=(g:ReturnType<typeof behaviorFixture>,action:string)=>{const a=[...g.world.agents.values()][0];a.inProgressOperation={name:'agentChooseAction',operationId:'test',started:100000};agentInputs.finishDecision.handler(g,100000,{agentId:a.id,operationId:'test',action,reason:'My plan comes first',source:'model'});return a;};

test.each(['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b'])('action schema reaches %s transport with allowed IDs only',async model=>{
 const options=[{id:'walk:river',kind:'walk' as const,label:'River',score:5}];let body:any;
 await requestModel({provider:'groq',model,key:'mock',messages:[],maxTokens:768,responseSchema:actionSchema(options),signal:new AbortController().signal},(async(_url,init)=>{body=JSON.parse(init!.body as string);return new Response(JSON.stringify({choices:[{message:{content:'{"action":"walk:river","reason":"A quiet walk","plan":null,"abandonPlan":false}'}}]}));}) as typeof fetch);
 expect(body.response_format.json_schema.strict).toBe(true);expect(body.response_format.json_schema.schema.properties.action.enum).toEqual(['walk:river']);
 expect(parseAction('{"action":"walk:river","reason":"A quiet walk","plan":null,"abandonPlan":false}',options).plan).toBeUndefined();
 expect(()=>parseAction('{"action":"fish","reason":"fish"}',options)).toThrow();
});
test.each(['No. I want some time on my own today. Please do not ask again.','Please give me some space.','I would rather be by myself.'])('solitude closes speech and acknowledgment: %s',text=>{
 const s=initialDialogue(),d=reply(text);expect(d.boundary?.scope).toBe('contact');expect(d.continueConversation).toBe(false);applyDialogue(s,'bob',d);
 const ack=reply('All right.');expect(reviewDialogue(ack,s,'lucky',[],[])).toBeUndefined();expect(ack.continueConversation).toBe(false);
 expect(reviewDialogue({...reply('Come for a walk?'),intent:'offer'},s,'lucky',[],[])).toBe('boundary_reopened');
});
test.each(["I don't want to be alone.",'I want to be useful.','Bob said leave me alone.','If I wanted time to myself, I would say so.'])('ordinary, negated and reported speech does not create solitude: %s',s=>expect(boundaryFromSpeech(s)).toBeUndefined());
test('an activity refusal leaves conversation available and blocks only that invitation',()=>{
 const d=reply('No walk. Sit and talk instead.');expect(d.continueConversation).toBe(true);expect(d.boundary?.scope).toBe('invitation');
 const b=rememberBoundary([],'bob','lucky',d.boundary!,d.speech,0);
 expect(blocksContact(b,'bob',1)).toBe(false);expect(blocksContact(b,'bob',1,'walk')).toBe(true);expect(blocksContact(b,'bob',1,'meal')).toBe(false);
});
test('today expires on the village clock, not server time; other residents are unaffected',()=>{
 const b=rememberBoundary([],'bob','lucky',boundaryFromSpeech('Leave me alone today.')!,'Leave me alone today.',2*WORLD_HOUR_MS);
 expect(b[0].expiresAt).toBe(16*WORLD_HOUR_MS);expect(blocksContact(b,'stella',3*WORLD_HOUR_MS)).toBe(false);expect(blocksContact(b,'bob',16*WORLD_HOUR_MS)).toBe(false);
});
test('actual message input persists a boundary, closes encounter and prevents re-approach after reload',()=>{
 const g=behaviorFixture(),[bob,lucky]=[...g.world.agents.values()],p=g.world.players.get(bob.playerId)!,other=g.world.players.get(lucky.playerId)!;
 const started=Conversation.start(g,100000,p,other);const c=g.world.conversations.get(started.conversationId!)!;
 for(const member of c.participants.values())member.status={kind:'participating',started:100000};
 bob.inProgressOperation={name:'agentGenerateMessage',operationId:'speech',started:100000};
 agentInputs.agentFinishSendingMessage.handler(g,100001,{agentId:bob.id,conversationId:c.id,operationId:'speech',timestamp:100001,leaveConversation:false,dialogue:reply('Leave me alone today.')});
 expect(g.world.conversations.has(c.id)).toBe(false);
 const restored=new Agent(lucky.serialize());expect(restored.awareness?.boundaries?.[0].speaker).toBe(bob.playerId);
 expect(Conversation.start(g,200000,other,p).error).toContain('boundary');
 const options=availableActions({...g.world.serialize(),awareness:restored.awareness},lucky.playerId,200000);
 expect(options.some(o=>o.target===bob.playerId)).toBe(false);
});
test.each([89,90,96])('physical priority at hunger %s is revalidated before execution',hunger=>{
 const g=behaviorFixture(),a=[...g.world.agents.values()][0],n=g.world.livelihood!.needs[0];n.hunger=hunger;n.energy=80;
 a.learning={active:{label:'Walk then garden',steps:['walk:river','walk:garden'],index:0},routines:[],evidence:[]};
 const options=availableActions(g.world.serialize(),a.playerId,100000);
 if(hunger<90){expect(options.some(o=>o.id==='walk:river')).toBe(true);return;}
 expect(options.every(o=>o.kind==='eat')).toBe(true);choose(g,'walk:river');
 expect(a.decision?.kind).toBe('eat');expect(a.learning.active?.index).toBe(0);expect(a.learning.active?.state).toBe('suspended');
 expect(g.world.livelihood!.jobs[0].kind).toBe('eat');
});
test('no food cannot invent eating; hunger recovery also outranks severe sleep debt',()=>{
 const g=behaviorFixture(),a=[...g.world.agents.values()][0],n=g.world.livelihood!.needs[0];n.hunger=96;n.restedness=0;g.world.economy!.bags[0].items.meals=0;
 const opts=availableActions(g.world.serialize(),a.playerId,100000);expect(opts.some(o=>o.kind==='eat')).toBe(false);expect(opts.map(o=>o.kind)).toEqual(['forage']);
 choose(g,'eat:meals');expect(a.decision?.kind).toBe('forage');expect(g.world.economy!.bags[0].items.meals).toBe(0);
});
test('personality preserves late values and voice rather than cutting a biography prefix',()=>{
 const card=characterContext('Bob','Bob keeps an orchard.\n'+('An old memory. '.repeat(160))+'\nValues: independence. Blind spot: caution.\nVoice: restrained. Personal tension: wants companionship.','Learn to measure land');
 expect(card.valuesAndContradictions).toContain('independence');expect(card.voiceAndPersonalTension).toContain('companionship');expect(card.direction).toContain('measure');expect(card.history).toHaveLength(0);
});
test('recipe facts use engine ingredients; motives cannot introduce requirements, preferences remain free',()=>{
 expect(actionFacts({id:'cook:fish',kind:'cook',label:'Fish supper',score:1}).requires).toEqual({fish:1,turnips:0});
 expect(actionMotiveIssue('Need fresh water for cooking')).toBe('unsupported_recipe_requirement');expect(actionMotiveIssue('I enjoy watching the water')).toBeUndefined();
 const g=behaviorFixture(),bag=structuredClone(g.world.economy!.bags[0].items);choose(g,'cook:fish');expect(g.world.economy!.bags[0].items).toEqual(bag);expect(g.world.livelihood!.jobs.some(j=>j.kind==='cook')).toBe(false);
});
test('invalid optional plans cannot discard a valid choice or replace the existing plan',()=>{
 const g=behaviorFixture(),options=availableActions(g.world.serialize(),'p:0',100000);
 const d=parseAction(JSON.stringify({action:'walk:river',reason:'A quiet walk',plan:{label:'Wrong order',steps:['garden','walk:river']},abandonPlan:false}),options);
 expect(d.option.id).toBe('walk:river');expect(d.plan).toBeUndefined();expect(d.planIssue).toContain('discarded');
 const a=[...g.world.agents.values()][0];a.learning={active:{label:'Unfinished garden work',steps:['walk:garden','garden'],index:1},routines:[],evidence:[]};choose(g,d.option.id);expect(a.learning.active?.label).toBe('Unfinished garden work');
});
test('a mislabeled acknowledgment cannot create a reciprocal boundary',()=>{
 const d=reply('I will give you your space.');
 const parsed=parseDialogue(JSON.stringify({...d,boundary:{scope:'contact',activity:'any',durationMinutes:60}}));expect(parsed.boundary).toBeNull();
});
test('quotations cannot create a contact ban; acknowledgments cannot reverse one',()=>{
 const text="Someone once told me, 'leave me alone.' That isn't what I'm saying to you. I enjoy our chats.";
 expect(boundaryFromSpeech(text)).toBeUndefined();
 for(const speech of ['Understood, Bob. Take the quiet you need.',"I'll give you the space you need.",'I hear you. I will keep to the orchard today.']){
  expect(parseDialogue(JSON.stringify({...reply(speech),boundary:{scope:'contact',activity:'any',durationMinutes:60}})).boundary).toBeNull();
 }
 expect(boundaryFromSpeech('Please let me have some time to myself. I am not taking visitors today.')?.scope).toBe('contact');
});
