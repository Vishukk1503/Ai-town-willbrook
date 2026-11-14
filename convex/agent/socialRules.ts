import { Relationship, Dispositions, dimensions } from '../../data/socialProfiles';
export function interpretSpeech(text:string,recipientName:string){
  const escapedName=recipientName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const s=text.replace(/[’]/g,"'").trim().replace(new RegExp(`^${escapedName},?\\s*`,'i'),'');
  if(/^I(?:'m| am) sorry(?:\b)/i.test(s))return {kind:'apology',sentiment:'Acknowledged an apology; repair still needs follow-through.',delta:{tension:-2} as Partial<Relationship>};
  if(/^Thank you for\b/i.test(s))return {kind:'gratitude',sentiment:'Was directly appreciated.',delta:{affection:1} as Partial<Relationship>};
  if(/^I (?:can|would like to) help you\b/i.test(s))return {kind:'offer',sentiment:'Received an offer of help; no work has been verified.',delta:{affection:1} as Partial<Relationship>};
  if(/^I (?:can't|cannot|don't want to) (?:help|join|come)\b/i.test(s))return {kind:'decline',sentiment:'Heard a boundary; declining is not a betrayal.',delta:{} as Partial<Relationship>};
  if(/^I feel (?:worried|lonely|embarrassed|afraid|overwhelmed)\b/i.test(s))return {kind:'disclosure',sentiment:'Was trusted with a personal feeling; do not assume intimacy.',delta:{} as Partial<Relationship>};
  return null;
}
export function applyChanges(base:Relationship,deltas:Partial<Relationship>[]){
  const scores={...base};for(const d of deltas)for(const k of dimensions)scores[k]=Math.max(0,Math.min(100,scores[k]+(d[k]??0)));return scores;
}
export function chooseIntention(traits:Dispositions,relation:Relationship,latestKind?:string){
  const candidates=[
    {intent:'share an observation',score:20+traits.curiosity*.25,reason:'Curiosity makes a small observation a natural opening.'},
    {intent:'ask a grounded question',score:15+traits.curiosity*.2+traits.caution*.15,reason:'Interest and caution favor understanding before committing.'},
    {intent:'share a small personal feeling',score:traits.vulnerability*.4+relation.safety*.25+relation.affection*.1,reason:'Comfort and openness make a modest disclosure possible.'},
    {intent:'acknowledge the other person',score:latestKind?90:10,reason:'Respond to their social gesture before changing the subject.'},
    {intent:'state a gentle boundary',score:relation.tension*.7+traits.autonomy*.1,reason:'Current tension favors a clear boundary rather than escalation.'},
  ];
  return candidates.sort((a,b)=>b.score-a.score)[0];
}
export function describeRelationship(r:Relationship){
  return `${r.affection>=50?'Feels fond':r.affection>=30?'Some warmth':'Still guarded'}; ${r.trust<45?'unsure of reliability':r.trust>=65?'usually expects follow-through':'reliability is still being learned'}; ${r.respect>=65?'respects their abilities':'still getting to know their abilities'}${r.tension>=30?'; some unresolved tension':''}.`;
}
