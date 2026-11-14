import type {SerializedWorld} from './world';
export function resumeState(world:Pick<SerializedWorld,'agents'|'conversations'|'clock'>,completedOperations:ReadonlySet<string>=new Set()):Pick<SerializedWorld,'agents'|'conversations'|'clock'>{
  return {
    ...(world.clock?{clock:{elapsedMs:world.clock.elapsedMs}}:{}),
    agents:world.agents.map(agent=>{
      if(!['agentGenerateMessage','agentChooseAction'].includes(agent.inProgressOperation?.name??''))return agent;
      if(agent.inProgressOperation&&completedOperations.has(agent.inProgressOperation.operationId))return agent;
      const {inProgressOperation,...rest}=agent;return rest;
    }),
    conversations:world.conversations.map(({isTyping,...conversation})=>conversation),
  };
}
