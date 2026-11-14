import {parseDialogue,initialDialogue,applyDialogue,repeatedSentence,repeatedMove,farewell,groundingIssue,settleAcknowledgment,DialogueDecision} from '../convex/aiTown/dialogueState';
import {Conversation} from '../convex/aiTown/conversation';
const decision=(patch:Partial<DialogueDecision>={}):DialogueDecision=>({speech:'Your portion is ready.',intent:'share',continueConversation:true,topic:'supper',question:null,answersQuestion:false,proposal:null,response:'none',proposalId:null,privateConcern:null,eventReferences:[],...patch});
test('structured farewells end immediately, including the actual failing dawn/soon phrases',()=>{
  expect(parseDialogue(JSON.stringify(decision({intent:'farewell'}))).continueConversation).toBe(false);
  for(const line of ['See you at dawn.','See you at first light.','See you soon.','See you at the bend.'])expect(farewell(line)).toBe(true);
  expect(farewell('Will I see you at dawn?')).toBe(false);
  expect(farewell('He said goodbye to his brother.')).toBe(false);
});
test('sentence repetition is caught inside a longer otherwise different reply',()=>{
  expect(repeatedSentence('It’s nice just to sit by the water, no rush.\nSee you at dawn.',['A loaf and broth?\nIt’s nice just to sit by the water, no rush.'])).toBe(true);
  expect(repeatedSentence('Yes.',['Yes.'])).toBe(false);
  expect(repeatedSentence("Aye, then. I'll be in the garden till the turnips need turning.",["I'll stay in the garden till the turnips need turning. No extra chores today."])).toBe(true);
});
test('answers resolve pending questions; accepted invitations cannot be reopened immediately',()=>{
  const s=initialDialogue();applyDialogue(s,'bob',decision({intent:'offer',question:'Will you join me?'}));
  applyDialogue(s,'lucky',decision({intent:'accept',answersQuestion:true}));
  expect(s.pendingQuestion).toBeUndefined();expect(s.resolved).toContain('Will you join me?');
  expect(repeatedMove(s,decision({intent:'offer'}),'bob')).toBe(true);
});
test('spoken questions are tracked even if the model leaves its question slot empty',()=>{
  const d=parseDialogue(JSON.stringify(decision({speech:'How is the garden?',intent:'ask'}))),s=initialDialogue();applyDialogue(s,'stella',d);
  expect(s.pendingQuestion?.text).toBe('How is the garden?');
  applyDialogue(s,'bob',decision({intent:'answer',answersQuestion:false}));expect(s.pendingQuestion).toBeUndefined();
  s.moves.push({speaker:'stella',intent:'share'});const ack=decision({speech:'Aye. The beds will hold.'});settleAcknowledgment(s,'bob',ack);expect(ack.continueConversation).toBe(false);
});
test('conversation state survives engine serialization between model requests',()=>{
  const s=initialDialogue();applyDialogue(s,'p:0',decision({intent:'ask',question:'Will you join me?'}));
  const c=new Conversation({id:'c:0' as any,creator:'p:0' as any,created:1,numMessages:1,participants:[],dialogue:s});
  const restored=new Conversation(c.serialize());expect(restored.dialogue?.pendingQuestion?.text).toBe('Will you join me?');
});
test('completed-action claims need supporting engine events, not just a plausible JSON response',()=>{
  expect(groundingIssue(decision({speech:'I ate the supper.'}),[])).toBe('unsupported_completed_action');
  expect(groundingIssue(decision({speech:'I ate the supper.',eventReferences:['life:1']}),[{id:'life:1',kind:'cook'}])).toBe('unsupported_completed_action');
  expect(groundingIssue(decision({speech:'I ate the supper.',eventReferences:['life:2']}),[{id:'life:2',kind:'eat'}])).toBeUndefined();
  expect(groundingIssue(decision({speech:'We could eat later.'}),[])).toBeUndefined();
});
test('malformed control fields and forged proposals are rejected; silence is an explicit valid choice',()=>{
  expect(()=>parseDialogue('{"speech":"Hello"}')).toThrow();
  expect(()=>parseDialogue(JSON.stringify(decision({continueConversation:'false' as any})))).toThrow();
  expect(()=>parseDialogue(JSON.stringify(decision({proposal:{activity:'meal',placeId:'tavern',delayMinutes:-1}})))).toThrow();
  expect(parseDialogue(JSON.stringify(decision({speech:'',intent:'silence'}))).intent).toBe('silence');
});

test('resolved acknowledgment chains end even when the model says thanks or will do',()=>{
 const s=initialDialogue();s.moves=[{speaker:'bob',intent:'share'},{speaker:'stella',intent:'answer'},{speaker:'bob',intent:'share'}];
 const d=decision({speech:'Thanks. I will ask if I need anything else.'});settleAcknowledgment(s,'stella',d);expect(d.continueConversation).toBe(false);
 const question=decision({speech:'Thanks, what did you think of the story?',question:'What did you think of the story?'});settleAcknowledgment(s,'stella',question);expect(question.continueConversation).toBe(true);
});
test('physical promises must use executable actions, while ordinary observations remain free',()=>{
 expect(groundingIssue(decision({speech:"I will water the beds and trim the rows."}),[])).toBe('unsupported_future_action');
 expect(groundingIssue(decision({speech:'I like how the old trees look from here.'}),[])).toBeUndefined();
});
