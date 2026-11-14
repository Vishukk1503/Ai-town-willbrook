import {socialProfiles} from './socialProfiles';

// Keep complete semantic sections, including values and voice at the end of a bio.
// No model call and no prefix truncation that silently drops a character's tension.
export function characterContext(name:string,identity:string,direction:string){
 const paragraphs=identity.split(/\n+/).map(p=>p.trim()).filter(Boolean);
 const profile=socialProfiles[name];
 const history:string[]=[];let used=0;
 for(const p of paragraphs.slice(1).filter(p=>!p.startsWith('Values:')&&!p.startsWith('Voice:'))){
  if(used+p.length<=1000){history.push(p);used+=p.length;}
 }
 return {identity:paragraphs[0]??name,valuesAndContradictions:paragraphs.find(p=>p.startsWith('Values:'))??profile?.values.join(', '),voiceAndPersonalTension:paragraphs.find(p=>p.startsWith('Voice:')),direction,history,dispositions:profile?.traits,boundary:profile?.boundary,stressResponse:profile?.stressResponse};
}
export const characterContextInstructions='Character fields describe tendencies, not compulsory topics or catchphrases. Let values affect choices; do not explain your biography. Work is one part of your life. You can enjoy company, have an ordinary opinion, disagree, or be quiet without assigning a task. Mood changes your manner, not your entire identity.';
