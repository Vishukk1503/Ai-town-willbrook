import {repeatedSentence} from './dialogueState';
import {repeatsDialogue} from '../../data/dialogue';

// Advisory context for the next existing turn, never a publication or ending rule.
export function repetitionFeedback(ownMessages: string[]): string {
  const recent = ownMessages.filter(text => text.trim()).slice(-6);
  if (recent.length < 2) return '';
  const latest = recent[recent.length - 1], previous = recent.slice(0, -1);
  if (!repeatedSentence(latest, previous) && !repeatsDialogue(latest, previous)) return '';
  return 'Conversation feedback: your last reply appears to repeat something you already said in this conversation. Consider adding a new relevant detail, responding to your partner, or ending if you feel finished. You decide whether to continue or end; this is advice, not a requirement.';
}
