import {Infer,v} from 'convex/values';
import {WORLD_MINUTE_MS,worldTime} from '../../data/worldTime';
export const boundaryRequest=v.object({scope:v.union(v.literal('contact'),v.literal('invitation')),activity:v.union(v.literal('any'),v.literal('walk'),v.literal('meal'),v.literal('help'),v.literal('visit')),durationMinutes:v.number()});
export type BoundaryRequest=Infer<typeof boundaryRequest>;
export const socialBoundary=v.object({speaker:v.string(),recipient:v.string(),scope:v.union(v.literal('contact'),v.literal('invitation')),activity:v.string(),expiresAt:v.number(),sourceText:v.string()});
export type SocialBoundary=Infer<typeof socialBoundary>;
export const boundaryJsonSchema={anyOf:[{type:'null'},{type:'object',properties:{scope:{type:'string',enum:['contact','invitation']},activity:{type:'string',enum:['any','walk','meal','help','visit']},durationMinutes:{type:'number'}},required:['scope','activity','durationMinutes'],additionalProperties:false}]};
export const boundaryInstructions='When YOUR speech explicitly requests solitude or no further contact, set boundary.scope=contact, activity=any, and end this encounter. When you only refuse an activity, use scope=invitation and its activity; friendly conversation may continue. boundary is null otherwise. Never put someone else\'s request in your own boundary field. durationMinutes uses village minutes, 60 if unspecified, up to 1440; an explicit today expires at the end of this village day. Respect a partner\'s request for solitude: one short acknowledgment, no question, no renewed invitation, continueConversation=false.';

// Conservative legacy/text fallback. Structured self-declarations handle other wording.
export function boundaryFromSpeech(text:string):BoundaryRequest|undefined{
 const s=text.toLowerCase().replace(/“[^”]*”|"[^"]*"|‘[^’]*’/g,' ').replace(/’/g,"'").replace(/(?:^|[\s,])'[^']+'(?=$|[\s.,!?])/g,' ');
 if(/^(?:["“]|\w+ said\b|if\b|suppose\b)/.test(s.trim()))return;
 const durationMinutes=/\btoday\b|\btonight\b/.test(s)?1440:60;
 if(/\b(?:leave me alone|let me (?:have )?(?:some )?time to myself|i am not taking visitors|give me (?:some )?(?:space|privacy)|i (?:want|need|would like) (?:(?:some )?time (?:on my own|to myself)|to be (?:alone|by myself)|some privacy)|i(?:'d| would) (?:rather|prefer to) be (?:alone|by myself))\b/.test(s))return {scope:'contact',activity:'any',durationMinutes};
 if(/(?:^|[.!?]\s*)(?:no(?: thanks)?[,.]?\s|not (?:a |another |today.*)?|i (?:don't|do not|would rather not) (?:want to |fancy |go )?)/.test(s)){
  const activity=/\bwalk(?:ing)?\b/.test(s)?'walk':/\bmeal|supper|dinner\b/.test(s)?'meal':/\bhelp\b/.test(s)?'help':/\bvisit\b/.test(s)?'visit':undefined;
  if(activity)return {scope:'invitation',activity,durationMinutes};
 }
}
export function validateBoundary(b:unknown):BoundaryRequest|null{
 if(b===undefined||b===null)return null;
 const x=b as BoundaryRequest;
 if(typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['scope','activity','durationMinutes'].includes(k))||!['contact','invitation'].includes(x.scope)||!['any','walk','meal','help','visit'].includes(x.activity)||!Number.isFinite(x.durationMinutes)||x.durationMinutes<=0||x.durationMinutes>1440)throw new Error('Invalid social boundary');
 return {...x,activity:x.scope==='contact'?'any':x.activity};
}
export function rememberBoundary(previous:SocialBoundary[]|undefined,speaker:string,recipient:string,request:BoundaryRequest,text:string,clock:number){
 const t=worldTime(clock),minutes=/\b(?:today|tonight)\b/i.test(text)?(24-t.hour)*60-t.minute:request.durationMinutes;
 return [...(previous??[]).filter(b=>b.expiresAt>clock&&!(b.speaker===speaker&&b.recipient===recipient&&b.scope===request.scope&&b.activity===request.activity)),{...request,speaker,recipient,sourceText:text.slice(0,240),expiresAt:clock+minutes*WORLD_MINUTE_MS}].slice(-24);
}
export function blocksContact(boundaries:SocialBoundary[]|undefined,target:string,clock:number,activity?:string){
 return (boundaries??[]).some(b=>b.speaker===target&&b.expiresAt>clock&&(b.scope==='contact'||activity!==undefined&&(b.activity==='any'||b.activity===activity)));
}

export function ownBoundary(text:string,claimed?:BoundaryRequest|null){
 const explicit=boundaryFromSpeech(text);
 if(explicit)return {...explicit,durationMinutes:claimed?.scope===explicit.scope?claimed.durationMinutes:explicit.durationMinutes};
 // A declared boundary needs the speaker's own request in the utterance.
 // Acknowledgments and quoted requests cannot create reciprocal restrictions.
 if(claimed&&/(?:^|[.!?]\s*)(?:please )?(?:i (?:need|want|would like|would prefer)|i['’]d (?:like|prefer)|let me|give me)\b[^.!?]*(?:solitude|privacy|peace|alone|by myself|time to myself)/i.test(text))return claimed;
 return undefined;
}
