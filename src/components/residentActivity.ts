export function residentActivity(state:{
  running:boolean; councilRunning?:boolean; now:number;
  sleep?:{phase:string};casual?:boolean;
  manualMove?:unknown;
  membership?:string; typing?:boolean;
  operation?:{name:string;started:number};
  pathfinding?:unknown; activity?:{description:string;until:number};
}){
  if(!state.running)return state.councilRunning?'At the council':'World paused';
  if(state.manualMove)return 'Walking to the spot you selected';
  if(state.sleep)return state.sleep.phase==='asleep'?'Sleeping at home':'Going home to sleep';
  const operation=state.operation;
  if(operation?.name==='agentChooseAction')return 'Choosing the next activity';
  if(operation?.name==='agentGenerateMessage'){
    const seconds=Math.max(0,Math.floor((state.now-operation.started)/1000));
    return seconds>=10?`Waiting for a reply · ${seconds}s`:'Thinking of a reply';
  }
  if(operation?.name==='agentRememberConversation')return 'Remembering a conversation';
  if(state.typing)return 'Thinking of a reply';
  if(state.membership==='invited')return 'Considering an invitation';
  if(state.membership==='walkingOver')return 'Meeting a neighbor';
  if(state.membership==='participating')return state.casual?(state.pathfinding?'Chatting while walking':'Brief nearby conversation'):'In conversation';
  if(state.pathfinding)return 'Exploring';
  if(state.activity&&state.activity.until>state.now)return state.activity.description;
  if(operation?.name==='agentDoSomething')return 'Choosing what to do';
  return 'Taking a moment';
}
