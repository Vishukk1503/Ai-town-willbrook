import {v} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {internalMutation,query} from './_generated/server';
import {persistDecisionEvents} from './decisionHistoryStore';
export const begin=internalMutation({args:{worldId:v.id('worlds'),operationId:v.string(),playerId:v.string(),contextJson:v.string(),at:v.number(),clock:v.number()},handler:async(ctx,a)=>{
 if(a.contextJson.length>250000)throw new Error('Decision context exceeds the audit limit.');
 const existing=await ctx.db.query('decisionAudits').withIndex('operation',q=>q.eq('worldId',a.worldId).eq('operationId',a.operationId)).unique();
 if(existing)return existing.contextJson??a.contextJson;
 await ctx.db.insert('decisionAudits',{worldId:a.worldId,operationId:a.operationId,playerId:a.playerId,requestedAt:a.at,clock:a.clock,updatedAt:a.at,status:'requested',contextJson:a.contextJson});
 await ctx.db.insert('decisionEvents',{worldId:a.worldId,eventKey:'request:'+a.operationId,operationId:a.operationId,playerId:a.playerId,at:a.at,clock:a.clock,phase:'requested',summary:'Captured the exact model menu, bodily state and decision context before the request.'});
 return a.contextJson;
}});
export const abandon=internalMutation({args:{worldId:v.id('worlds'),operationId:v.string(),playerId:v.string(),clock:v.number(),reason:v.string()},handler:async(ctx,a)=>{
 await persistDecisionEvents(ctx,a.worldId,[{key:a.operationId,playerId:a.playerId,at:Date.now(),clock:a.clock,phase:'cancelled',summary:a.reason,status:'cancelled'}]);
}});
export const list=query({args:{worldId:v.id('worlds'),playerId:v.string(),paginationOpts:paginationOptsValidator},handler:async(ctx,a)=>{
 const result=await ctx.db.query('decisionAudits').withIndex('resident',q=>q.eq('worldId',a.worldId).eq('playerId',a.playerId)).order('desc').paginate({...a.paginationOpts,numItems:Math.min(20,a.paginationOpts.numItems)});
 return {...result,page:result.page.map(({contextJson,menuJson,...row})=>row)};
}});
export const detail=query({args:{worldId:v.id('worlds'),operationId:v.string()},handler:async(ctx,a)=>{
 const row=await ctx.db.query('decisionAudits').withIndex('operation',q=>q.eq('worldId',a.worldId).eq('operationId',a.operationId)).unique();if(!row)return null;
 const events=await ctx.db.query('decisionEvents').withIndex('operation',q=>q.eq('worldId',a.worldId).eq('operationId',a.operationId)).order('asc').take(200);
 const requests=[];for(const attempt of [0,1]){const r=await ctx.db.query('modelRequests').withIndex('key',q=>q.eq('key','action:'+a.operationId+':'+attempt)).unique();if(r){const {provider,model,status,inputTokens,outputTokens,ms,chargedMicros,error}=r;requests.push({provider,model,status,inputTokens,outputTokens,ms,chargedMicros,error});}}
 return {row,events,requests,eventsCapped:events.length===200,retention:'Retained until explicitly deleted with the world/database. Logging starts when this feature is installed; older snapshots are not backfilled.'};
}});

export const worldEvents=query({args:{worldId:v.id('worlds'),paginationOpts:paginationOptsValidator},handler:async(ctx,a)=>ctx.db.query('decisionEvents').withIndex('world',q=>q.eq('worldId',a.worldId)).order('desc').paginate({...a.paginationOpts,numItems:Math.min(50,a.paginationOpts.numItems)})});
