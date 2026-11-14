// Ordered selector: the engine owns execution; the model chooses inside the final branch.
export const RESIDENT_TREE=[
  {id:'recover',label:'Protect urgent physical needs'},
  {id:'agreement',label:'Fulfil an accepted agreement'},
  {id:'conversation',label:'Respond to the current encounter'},
  {id:'intention',label:'Carry out the current intention'},
  {id:'choose',label:'Choose among scored opportunities'},
] as const;
export function behaviorBranch(s:{urgent:boolean;agreement:boolean;conversation:boolean;committed:boolean}){
  return RESIDENT_TREE[s.urgent?0:s.agreement?1:s.conversation?2:s.committed?3:4].label;
}
