import {resumeState} from '../convex/aiTown/resumeState';
test('resuming discards cancelled foreground request locks while preserving intentions, memory and dialogue state',()=>{
  const world:any={agents:[{id:'a:0',decision:{reason:'Find Lucky'},memoryQueue:['c:1'],memoryOperation:{operationId:'summary'},inProgressOperation:{name:'agentGenerateMessage',operationId:'cancelled'}},{id:'a:1',inProgressOperation:{name:'agentRememberConversation',operationId:'summary2'}}],conversations:[{id:'c:1',numMessages:3,dialogue:{topic:'food'},isTyping:{playerId:'p:0'}}]};
  const r=resumeState(world);expect(r.agents[0].inProgressOperation).toBeUndefined();expect(r.agents[0].decision?.reason).toBe('Find Lucky');expect(r.agents[0].memoryQueue).toEqual(['c:1']);expect(r.agents[0].memoryOperation).toEqual({operationId:'summary'});expect(r.agents[1].inProgressOperation?.operationId).toBe('summary2');expect(r.conversations[0].dialogue?.topic).toBe('food');expect(r.conversations[0].isTyping).toBeUndefined();
  expect(world.agents[0].inProgressOperation.operationId).toBe('cancelled');
  expect(resumeState(world,new Set(['cancelled'])).agents[0].inProgressOperation?.operationId).toBe('cancelled');
});
