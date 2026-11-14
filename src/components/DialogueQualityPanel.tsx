import {useQuery} from 'convex/react';
import {api} from '../../convex/_generated/api';
export default function DialogueQualityPanel(){
  const d=useQuery(api.dialogueReview.state);if(!d)return null;
  return <details className="profile-story"><summary>Conversation quality · {d.sample} recent decisions</summary><p className="inspector-note">Controller telemetry since this update; up to 300 decisions. Guard flags are limited checks, not a complete measure of dialogue quality.</p><p>{d.spoken} spoken turns · {d.silent} quiet choices · {d.endings} normal endings</p><p>{d.repairs} repaired replies · {d.repetitionBlocks} repetition blocks · {d.groundingBlocks} grounding flags · {d.invalidOrProvider} invalid/provider failures</p><p>Sampled median provider time: {d.medianMs===null?'No completed town replies yet':`${d.medianMs} ms`}</p>{d.pairs.map(p=><p key={p.name}>{p.name}: {p.turns} decisions, {p.endings} endings</p>)}<p className="inspector-note">Spending and token usage remain available in Models & usage.</p></details>;
}
