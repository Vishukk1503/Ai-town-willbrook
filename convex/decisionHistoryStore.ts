import type {MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import type {JournalEvent} from './aiTown/decisionJournal';
const terminal=new Set(['completed','failed','rejected','cancelled','interrupted','unverified']);
export async function persistDecisionEvents(ctx:MutationCtx,worldId:Id<'worlds'>,events:JournalEvent[]){
 for(const e of events){
  const eventKey=e.key+':'+e.at+':'+e.phase;
  const rows=e.playerId==='*'&&e.relatedKey?await ctx.db.query('decisionAudits').withIndex('related',q=>q.eq('worldId',worldId).eq('relatedKey',e.relatedKey)).collect():[];
  let row=e.playerId==='*'?null:await ctx.db.query('decisionAudits').withIndex('operation',q=>q.eq('worldId',worldId).eq('operationId',e.key)).unique();
  if(!row&&e.playerId!=='*'){
   const id=await ctx.db.insert('decisionAudits',{worldId,operationId:e.key,playerId:e.playerId,requestedAt:e.at,clock:e.clock,status:'requested',updatedAt:e.at});row=await ctx.db.get(id);
  }
  if(e.playerId==='*'){
   if(!await ctx.db.query('decisionEvents').withIndex('eventKey',q=>q.eq('worldId',worldId).eq('eventKey',eventKey)).unique())await ctx.db.insert('decisionEvents',{worldId,eventKey,operationId:e.key,playerId:'*',at:e.at,clock:e.clock,phase:e.phase,summary:e.summary,...(e.dataJson?{dataJson:e.dataJson}:{}),...(e.relatedKey?{relatedKey:e.relatedKey}:{})});
  }
  if(row)rows.push(row);
  for(const r of rows){
   if(await ctx.db.query('decisionEvents').withIndex('eventKey',q=>q.eq('worldId',worldId).eq('eventKey',eventKey+':'+r.operationId)).unique())continue;
   await ctx.db.insert('decisionEvents',{worldId,eventKey:eventKey+':'+r.operationId,operationId:r.operationId,playerId:r.playerId,at:e.at,clock:e.clock,phase:e.phase,summary:e.summary,...(e.dataJson?{dataJson:e.dataJson}:{}),...(e.relatedKey?{relatedKey:e.relatedKey}:{})});
   // Terminal physical evidence wins over later bookkeeping/supersession.
   const relatedTask=!!r.relatedKey&&e.phase==='superseded';
   const resuming=e.phase==='resumed'&&['interrupted','unverified'].includes(r.status);
   const keep=terminal.has(r.status)&&!(['unverified','interrupted'].includes(r.status)&&e.status==='completed')&&!resuming;
   const patch:Record<string,unknown>={updatedAt:e.at};if(resuming)patch.finishedAt=undefined;
   if(e.choice){Object.assign(patch,e.choice,{chosenAt:e.at,clock:e.clock,...(e.relatedKey?{relatedKey:e.relatedKey}:{})});}
   if(e.status&&!keep&&!relatedTask){patch.status=e.status;patch.outcome=e.summary;if(terminal.has(e.status))patch.finishedAt=e.at;}
   await ctx.db.patch(r._id,patch);
  }
 }
}
