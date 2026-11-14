import {Infer,v} from 'convex/values';
const plan=v.object({label:v.string(),steps:v.array(v.string())});
export const learningState=v.object({
  active:v.optional(v.object({label:v.string(),steps:v.array(v.string()),index:v.number(),state:v.optional(v.union(v.literal('active'),v.literal('suspended'))),pauseReason:v.optional(v.string())})),
  routines:v.array(v.object({label:v.string(),steps:v.array(v.string()),successes:v.number(),failures:v.number()})),
  evidence:v.array(v.string()),lastOutcome:v.optional(v.string()),
});
export const proposedPlan=plan;
export type Learning=Infer<typeof learningState>;
export type ProposedPlan=Infer<typeof plan>;
export function initialLearning():Learning{return {routines:[],evidence:[]};}
export function validatePlan(p:unknown,action:string,available:string[]):ProposedPlan|undefined{
  if(p===undefined)return undefined;
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Invalid plan');
  const x=p as ProposedPlan;
  const permitted=(s:string)=>/^(fish|garden|forage|collect-food|rest|eat:(meals|turnips)|cook:(vegetable|fish|mixed)|walk:(river|garden))$/.test(s)||(s.startsWith('place:')&&available.includes(s));
  if(Object.keys(x).some(k=>!['label','steps'].includes(k))||typeof x.label!=='string'||!x.label.trim()||x.label.length>100||!Array.isArray(x.steps)||x.steps.length<2||x.steps.length>4||x.steps[0]!==action||x.steps.some(s=>typeof s!=='string'||!permitted(s)||/^(talk|visit|offer|respond|continue|wander)/.test(s)))throw new Error('Plan must use 2–4 verifiable allowed actions, beginning with this action');
  return {label:x.label.trim(),steps:x.steps};
}
export function suspendPlan(l:Learning,reason:string){
  if(!l.active)return;
  l.active.state='suspended';l.active.pauseReason=reason;
  l.lastOutcome=`Paused: ${l.active.label} — ${reason}`;
}
export function selectPlan(l:Learning,action:string,p?:ProposedPlan,abandon=false){
  if(abandon&&l.active){l.lastOutcome=`Abandoned: ${l.active.label}`;delete l.active;}
  if(p){
    if(l.active?.steps.join('|')!==p.steps.join('|')){
      l.lastOutcome=l.active?`Replaced: ${l.active.label} with ${p.label}`:`Started: ${p.label}`;
      l.active={...p,index:0,state:'active'};
    }
  }
  if(!l.active)return;
  if(l.active.steps[l.active.index]===action){
    if(l.active.state==='suspended')l.lastOutcome=`Resumed: ${l.active.label}`;
    l.active.state='active';delete l.active.pauseReason;
  }else suspendPlan(l,action==='sleep'?'Sleeping before reconsidering the plan':action==='rest'?'Recovering before reconsidering the plan':`Doing ${action} first; reconsider later`);
}
export function confirmStep(l:Learning,action:string,evidence:string){
  if(l.evidence.includes(evidence))return;
  l.evidence=[...l.evidence,evidence].slice(-40);
  if(!l.active||l.active.state==='suspended'||l.active.steps[l.active.index]!==action)return;
  l.active.index++;l.lastOutcome=`Completed ${action} from world evidence`;
  if(l.active.index<l.active.steps.length)return;
  const p=l.active,existing=l.routines.find(r=>r.steps.join('|')===p.steps.join('|'));
  if(existing)existing.successes++;else l.routines.push({label:p.label,steps:p.steps,successes:1,failures:0});
  l.routines=l.routines.slice(-12);l.lastOutcome=`Learned routine: ${p.label}`;delete l.active;
}
