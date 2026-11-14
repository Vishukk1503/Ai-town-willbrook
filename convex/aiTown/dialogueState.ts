import {boundaryRequest,boundaryJsonSchema,boundaryInstructions,boundaryFromSpeech,validateBoundary,ownBoundary} from './socialBoundary';
import {Infer,v} from 'convex/values';

export const speechIntent=v.union(...(['greet','answer','ask','share','offer','accept','decline','farewell','silence'] as const).map(x=>v.literal(x)));
export const encounterProposal=v.object({activity:v.union(v.literal('meal'),v.literal('walk'),v.literal('help'),v.literal('visit')),placeId:v.string(),destinationId:v.optional(v.string()),delayMinutes:v.number()});
export const dialogueDecision=v.object({boundary:v.optional(v.union(boundaryRequest,v.null())),speech:v.string(),intent:speechIntent,continueConversation:v.boolean(),topic:v.string(),question:v.union(v.string(),v.null()),answersQuestion:v.boolean(),proposal:v.union(encounterProposal,v.null()),response:v.union(v.literal('accept'),v.literal('decline'),v.literal('none')),proposalId:v.union(v.number(),v.null()),privateConcern:v.union(v.string(),v.null()),eventReferences:v.array(v.string())});
export type DialogueDecision=Infer<typeof dialogueDecision>;
export const dialogueState=v.object({commitments:v.optional(v.array(v.object({speaker:v.string(),text:v.string(),status:v.union(v.literal('proposed'),v.literal('acknowledged'),v.literal('declined')),respondent:v.optional(v.string())}))),boundary:v.optional(v.object({speaker:v.string(),request:boundaryRequest})),topic:v.string(),pendingQuestion:v.optional(v.object({speaker:v.string(),text:v.string()})),resolved:v.array(v.string()),moves:v.array(v.object({speaker:v.string(),intent:speechIntent})),closing:v.boolean(),quietUntil:v.optional(v.number())});
export type DialogueState=Infer<typeof dialogueState>;
export const initialDialogue=():DialogueState=>({topic:'',resolved:[],moves:[],closing:false});

export const dialogueSchema={type:'object',properties:{
  boundary:boundaryJsonSchema,speech:{type:'string'},intent:{type:'string',enum:['greet','answer','ask','share','offer','accept','decline','farewell','silence']},continueConversation:{type:'boolean'},topic:{type:'string'},question:{type:['string','null']},answersQuestion:{type:'boolean'},
  proposal:{anyOf:[{type:'null'},{type:'object',properties:{activity:{type:'string',enum:['meal','walk','help','visit']},placeId:{type:'string'},destinationId:{type:['string','null']},delayMinutes:{type:'number'}},required:['activity','placeId','destinationId','delayMinutes'],additionalProperties:false}]},
  response:{type:'string',enum:['accept','decline','none']},proposalId:{type:['integer','null']},privateConcern:{type:['string','null']},eventReferences:{type:'array',items:{type:'string'}},
},required:['boundary','speech','intent','continueConversation','topic','question','answersQuestion','proposal','response','proposalId','privateConcern','eventReferences'],additionalProperties:false};

const intents=['greet','answer','ask','share','offer','accept','decline','farewell','silence'];
export function parseDialogue(raw:string,inferBoundary=true):DialogueDecision{
  const x=JSON.parse(raw);
  const keys=Object.keys(dialogueSchema.properties);
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k))||keys.some(k=>k!=='boundary'&&!(k in x)))throw new Error('Incomplete dialogue decision');
  if(typeof x.speech!=='string'||!intents.includes(x.intent)||typeof x.continueConversation!=='boolean'||typeof x.answersQuestion!=='boolean'||typeof x.topic!=='string'||x.topic.length>100||!(x.question===null||typeof x.question==='string'&&x.question.length<=200)||!(x.privateConcern===null||typeof x.privateConcern==='string'&&x.privateConcern.length<=240)||!Array.isArray(x.eventReferences)||x.eventReferences.length>5||x.eventReferences.some((s:unknown)=>typeof s!=='string'||s.length>80)||!['accept','decline','none'].includes(x.response)||!(x.proposalId===null||Number.isSafeInteger(x.proposalId)&&x.proposalId>=0))throw new Error('Invalid dialogue decision');
  if(x.intent!=='silence'&&!x.speech.trim())throw new Error('Empty spoken turn');
  if(x.proposal!==null){const p=x.proposal;if(typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['activity','placeId','destinationId','delayMinutes'].includes(k))||!['meal','walk','help','visit'].includes(p.activity)||typeof p.placeId!=='string'||p.placeId.length>80||!(p.destinationId===null||p.destinationId===undefined||typeof p.destinationId==='string'&&p.destinationId.length<=80)||!Number.isFinite(p.delayMinutes)||p.delayMinutes<0||p.delayMinutes>30)throw new Error('Invalid activity proposal');if(p.destinationId===null)delete p.destinationId;}
  x.speech=x.speech.replace(/\\u0019/g,"'").replace(/\u0019/g,"'");
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x.speech))throw new Error('Invalid control character in speech');
  if(x.proposalId===null)x.response='none';
  if(x.question==='')x.question=null;
  if(x.question===null){const q=x.speech.split(/\n+|(?<=[.!?])\s+/).filter((line:string)=>line.trim().endsWith('?')).at(-1);if(q)x.question=q.trim().slice(0,200);}
  x.boundary=inferBoundary?(ownBoundary(x.speech,validateBoundary(x.boundary))??null):validateBoundary(x.boundary);
  if(x.boundary?.scope==='contact')x.continueConversation=false;
  if(x.intent==='farewell')x.continueConversation=false;
  return x;
}
// Keep the original speech even when action metadata cannot be used.
export function parseLiveDialogue(raw:string):{dialogue:DialogueDecision;actionError?:string}{
  const x=JSON.parse(raw);
  if(!x||typeof x.speech!=='string'||(!x.speech.trim()&&x.intent!=='silence'))throw Error('No spoken text');
  try { return {dialogue:{...parseDialogue(raw,false),speech:x.speech}}; }
  catch(e){
    return {actionError:e instanceof Error?e.message:'Invalid action metadata',dialogue:{
      speech:x.speech,intent:x.intent==='silence'?'silence':'share',
      continueConversation:x.continueConversation!==false,topic:'',question:null,
      answersQuestion:false,proposal:null,response:'none',proposalId:null,
      privateConcern:null,eventReferences:[],boundary:null,
    }};
  }
}
export function farewell(text:string){
  const last=text.trim().split(/\n+|(?<=[.!?])\s+/).filter(Boolean).at(-1)?.replace(/^["“]+|["”]+$/g,'')??'';
  return !text.includes('?')&&/^(?:goodbye\b|farewell\b|see you (?:at|soon|later|tomorrow|when|by)\b|I(?:['’]ll| will) (?:be off|head (?:home|back)|be on my way)\b|I should (?:go|be off)\b)/i.test(last);
}
const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function repeatedSentence(text:string,ownHistory:string[]){
  const sentences=(s:string)=>s.split(/\n+|(?<=[.!?])\s+/).map(normalize).filter(s=>s.split(' ').length>=6);
  const old=ownHistory.flatMap(sentences),prior=new Set(old);
  const filler=new Set(['a','the','i','ill','will','be','stay','in','to','and','aye','then','just','of','it','as','im','on','my']);
  const words=(s:string)=>new Set(s.split(' ').filter(w=>!filler.has(w)));
  return sentences(text).some(s=>prior.has(s)||old.some(p=>{const a=words(s),b=words(p);return a.size>=5&&b.size>=5&&[...a].filter(w=>b.has(w)).length/Math.max(a.size,b.size)>=.85;}));
}
export function applyDialogue(state:DialogueState,speaker:string,d:DialogueDecision){
  const boundary=d.boundary;
  if(boundary)state.boundary={speaker,request:boundary};
  const commitments=state.commitments??=[];
  if(d.intent==='offer')commitments.push({speaker,text:d.speech,status:'proposed'});
  if(d.intent==='accept'||d.intent==='decline'){
    const pending=commitments.filter(c=>c.speaker!==speaker&&c.status==='proposed');
    // Ambiguous responses do not silently accept several competing offers.
    if(pending.length===1){pending[0].status=d.intent==='accept'?'acknowledged':'declined';pending[0].respondent=speaker;}
  }
  state.commitments=commitments.slice(-8);

  if((d.answersQuestion||['answer','accept','decline'].includes(d.intent))&&state.pendingQuestion&&state.pendingQuestion.speaker!==speaker){state.resolved=[...state.resolved,state.pendingQuestion.text].slice(-6);delete state.pendingQuestion;}
  if(d.question)state.pendingQuestion={speaker,text:d.question};
  if(d.topic.trim())state.topic=d.topic.trim();
  state.moves=[...state.moves,{speaker,intent:d.intent}].slice(-8);
  state.closing=!d.continueConversation||d.intent==='farewell';
}
export function repeatedMove(state:DialogueState,d:DialogueDecision,speaker:string){
  if(state.closing)return true;
  const offered=state.moves.findLastIndex(m=>m.speaker===speaker&&m.intent==='offer');
  if(d.intent==='offer'&&d.topic===state.topic&&offered>=0&&state.moves.slice(offered+1).some(m=>m.speaker!==speaker&&m.intent==='accept'))return true;
  return false;
}
export function settleAcknowledgment(state:DialogueState,speaker:string,d:DialogueDecision){
  const after:DialogueState={...state,moves:[...state.moves],resolved:[...state.resolved],commitments:state.commitments?.map(c=>({...c}))};applyDialogue(after,speaker,d);
  const acknowledgment=/^(?:aye\b|sounds good\b|very well\b|fine\b|right\b|all right\b|will keep\b|will do\b|thanks\b|sure\b|alright\b|you['’]re welcome\b|much appreciated\b|thank you\b)/i.test(d.speech.trim());
  if(acknowledgment&&d.speech.split(/\s+/).length<=28&&!d.question&&!after.pendingQuestion&&!d.proposal&&state.moves.length>=3&&(after.resolved.length>0||state.moves.slice(-3).every(m=>['share','answer','accept'].includes(m.intent))))d.continueConversation=false;
}
export function groundingIssue(d:DialogueDecision,facts:{id:string;kind:string;text?:string}[]){
  if(d.eventReferences.some(id=>!facts.some(f=>f.id===id)))return 'unknown_event_reference';
  const text=d.speech.replace(/['’]ve/g,' have');
  if(/\brain last week\b|\bit rained\b|\bsoil(?:['’]s| is) (?:a bit )?dry\b/i.test(text))return 'unsupported_environment_detail';
  if(/\b(?:I|we)(?:['’]ll| will| shall| can| am going to| are going to)\s+(?:(?:help|you|to|go|and)\s+){0,3}(?:water|trim|prune|repair|build)\b/i.test(text))return 'unsupported_future_action';
  const checks:[RegExp,string[]][]=[
    [/\b(?:I|we) (?:have )?(?:just |already )?(?:ate|eaten|finished eating)\b/i,['eat']],
    [/\b(?:I|we) (?:have )?(?:just |already )?(?:cooked|prepared)\b/i,['cook','cooking_agreement']],
    [/\b(?:I|we) (?:have )?(?:just |already )?(?:traded|exchanged)\b/i,['barter','trade']],
    [/\b(?:I|we) (?:have )?(?:just |already )?caught\b/i,['fish']],
  ];
  for(const [pattern,kinds] of checks)if(pattern.test(text)&&!d.eventReferences.some(id=>facts.some(f=>f.id===id&&kinds.includes(f.kind)&&!(f.kind==='fish'&&/did not catch/i.test(f.text??'')))))return 'unsupported_completed_action';
  return undefined;
}
export const dialogueInstructions=`${boundaryInstructions} Return a JSON dialogue decision using the supplied schema. speech is only your spoken words (usually 1–3 short lines, 8–55 words, no stage directions). intent describes this turn. Set continueConversation=false when finished; farewell always ends the encounter. silence may have empty speech and lets you share a quiet moment. Track the actual topic; answersQuestion=true only when answering the partner's pending question. Never repeat an accepted invitation or a completed arrangement. A farewell is not an invitation for more chat. Ordinary banter needs no task or question. Choose whether to continue or end the conversation yourself; an acknowledgment can lead to more conversation. React in your own voice; do not turn every greeting into food, river scenery or another appointment. A personal opinion, mild disagreement, humour or a response to the partner is enough. Do not invent shared history. In a casual encounter keep it to one or two brief spoken lines and do not promise to travel elsewhere; keep doing your current activity. Use intent=offer for a proposal, intent=accept or decline for a response. proposal creates a real invitation only for the supplied valid places and activities; delayMinutes uses village-clock minutes (0=now, 1 village minute=1 real second), not invented dawn/tomorrow dates. Your spoken proposed time must match delayMinutes; do not say later when proposing now. response accepts/declines only an actual pending proposalId. Suggestions in speech alone do not schedule anything. privateConcern is null to keep your current concern, an empty string to resolve it, or a short subjective wish or concern without invented facts; it stays private. eventReferences may contain only supplied verified event IDs supporting factual action claims. Do not claim bread, nets, weather changes, eating, transfers or movement without supporting world state. Current executable actions are walk, fish, plant/harvest, cook, eat, trade, visit, rest and sleep. Do not promise watering, trimming, pruning, repairs or construction; those actions do not exist yet. Propose a formal shared activity only when availableSharedActivities offers it; otherwise just talk. Track spoken offers and responses in conversationState.commitments. Acknowledged speech is not an engine-confirmed transfer or scheduled task. Name the actual contributor; do not swap who owns an offered item. If several proposals are open, ask which one is meant. An upcoming activity is not completed. Recent completed cooking must not be described as still waiting to happen.`;
