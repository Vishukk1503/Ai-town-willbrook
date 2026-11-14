import {DialogueDecision,DialogueState,groundingIssue,repeatedSentence,repeatedMove,settleAcknowledgment,farewell} from './dialogueState';
import {repeatsDialogue} from '../../data/dialogue';
export function reviewDialogue(d:DialogueDecision,state:DialogueState,speaker:string,own:string[],facts:{id:string;kind:string;text?:string}[],inventory?:Record<string,number>){
 const contact=state.boundary?.request.scope==='contact';
 if(contact&&state.boundary?.speaker!==speaker){
  if(d.proposal||d.question||d.intent==='offer')return 'boundary_reopened';
  d.continueConversation=false;
 }
 const issue=inventoryIssue(d.speech,inventory)||groundingIssue(d,facts)||(repeatedSentence(d.speech,own)||repeatsDialogue(d.speech,own)||(!contact&&repeatedMove(state,d,speaker))?'repetition':undefined);
 if(issue)return issue;
 settleAcknowledgment(state,speaker,d);if(farewell(d.speech))d.continueConversation=false;
}

// Deliberately bounded checks; unknown paraphrases remain a semantic limitation.
export function inventoryIssue(text:string,inventory?:Record<string,number>){
 if(!inventory)return;
 const t=text.toLowerCase().replace(/[’]/g,"'");
 const counts:Record<string,number>={a:1,an:1,one:1,two:2,three:3,four:4,five:5};
 const aliases:Record<string,string>={fish:'fish',turnip:'turnips',turnips:'turnips',seed:'seeds',seeds:'seeds',meal:'meals',meals:'meals'};
 for(const m of t.matchAll(/\b(?:i have|i've got|i carry|i can give|i can offer|i'll bring) (a|an|one|two|three|four|five|\d+) (fish|turnips?|seeds?|meals?)\b/g)){
 const amount=counts[m[1]]??Number(m[1]),key=aliases[m[2]];
 if(amount>(inventory[key]??0))return 'insufficient_owned_resource';
 }
 if(/\b(?:my|our) (?:pan|net|bread|fire)\b|\bi(?:'ve| have) got (?:a |the )?(?:pan|net|fire)\b/.test(t))return 'unsupported_equipment';
 return undefined;
}
