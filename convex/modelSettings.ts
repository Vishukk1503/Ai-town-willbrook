import {v} from 'convex/values';
import type {Id} from './_generated/dataModel';
import {query,mutation,internalQuery,internalMutation,action} from './_generated/server';
import {internal} from './_generated/api';
import {parseGameId} from './aiTown/ids';
import {modelReply} from './modelReply';
import {MODEL_PRICES,PRICE_DATE,costMicros,assertBudget} from './util/modelCosts';
const defaults={provider:'local' as const,model:'',overrides:[] as {name:string;model:string}[],maxTokens:512,rpm:2,tpm:6000,dailyRequests:100,cooldownUntil:undefined as number|undefined};
export const state=query({args:{},handler:async ctx=>{
  const settings=await ctx.db.query('modelSettings').first();
  const recent=await ctx.db.query('modelRequests').order('desc').take(100);
  const budget=await ctx.db.query('modelBudgets').first();
  return {settings:settings??defaults,budget,prices:MODEL_PRICES,priceDate:PRICE_DATE,hasKey:!!process.env.GROQ_API_KEY,requests:recent.map(({content,key,...safe})=>safe)};
}});
export const save=mutation({args:{provider:v.union(v.literal('local'),v.literal('groq')),model:v.string(),overrides:v.array(v.object({name:v.string(),model:v.string()})),maxTokens:v.number(),rpm:v.number(),tpm:v.number(),dailyRequests:v.number()},handler:async(ctx,a)=>{
  if(a.provider==='groq'&&(!process.env.GROQ_API_KEY||!a.model.trim()))throw new Error('Configure the backend key and choose a model first.');
  if(a.model.length>150||a.overrides.length>3||a.overrides.some(o=>!['Lucky','Bob','Stella'].includes(o.name)||o.model.length>150))throw new Error('Invalid character models.');
  if(!Number.isInteger(a.maxTokens)||a.maxTokens<128||a.maxTokens>2048||!Number.isInteger(a.rpm)||a.rpm<0||a.rpm>30||!Number.isInteger(a.tpm)||a.tpm<0||a.tpm>100000||!Number.isInteger(a.dailyRequests)||a.dailyRequests<0||a.dailyRequests>1000)throw new Error('Invalid request limits.');
  const budget=await ctx.db.query('modelBudgets').first();
  if(a.dailyRequests===0&&!budget)throw new Error('Configure a spending budget before disabling the daily request cap.');
  if(budget&&a.provider==='groq'&&[a.model,...a.overrides.map(o=>o.model)].some(m=>!MODEL_PRICES[m]))throw new Error('Budget pricing is available only for the three configured Groq dialogue models.');
  const old=await ctx.db.query('modelSettings').first();if(old)await ctx.db.patch(old._id,a);else await ctx.db.insert('modelSettings',a);
}});
export const enableFiveDollarBudget=internalMutation({args:{},handler:async ctx=>{
  let budget=await ctx.db.query('modelBudgets').first();
  if(!budget){const id=await ctx.db.insert('modelBudgets',{limitMicros:5000000,safetyMicros:500000,spentMicros:0,reservedMicros:0,createdAt:Date.now()});budget=(await ctx.db.get(id))!;}
  const settings=await ctx.db.query('modelSettings').first();
  if(!settings)throw new Error('Configure models first.');
  if([settings.model,...settings.overrides.map(o=>o.model)].some(m=>!MODEL_PRICES[m]))throw new Error('A configured model has no verified price.');
  await ctx.db.patch(settings._id,{dailyRequests:0});
  return {totalUsd:budget.limitMicros/1e6,stopAtUsd:(budget.limitMicros-budget.safetyMicros)/1e6,spentUsd:budget.spentMicros/1e6,dailyRequestCap:'disabled',resetsAutomatically:false};
}});
export const plan=internalQuery({args:{actor:v.string()},handler:async(ctx,{actor})=>{
  const s=await ctx.db.query('modelSettings').first()??defaults;
  return {...s,chosenModel:s.provider==='local'?(process.env.OLLAMA_MODEL??'qwen3:1.7b'):s.overrides.find(o=>o.name===actor)?.model||s.model,hasKey:!!process.env.GROQ_API_KEY};
}});
export const active=internalQuery({args:{worldId:v.optional(v.id('worlds')),operationId:v.optional(v.string()),sessionId:v.optional(v.id('councilSessions')),expected:v.optional(v.number()),attempt:v.optional(v.number())},handler:async(ctx,a)=>{
  if(a.sessionId){const s=await ctx.db.get(a.sessionId);return !!s&&s.status==='running'&&s.nextTurn===a.expected&&(s.attempt??0)===(a.attempt??0);}
  if(a.worldId&&a.operationId){const w=await ctx.db.get(a.worldId),status=await ctx.db.query('worldStatus').withIndex('worldId',q=>q.eq('worldId',a.worldId!)).first();return status?.status==='running'&&!!w?.agents.some(p=>p.inProgressOperation?.operationId===a.operationId);}
  return true;
}});
export const reserve=internalMutation({args:{key:v.string(),provider:v.string(),model:v.string(),actor:v.string(),scope:v.string(),sessionId:v.optional(v.id('councilSessions')),estimatedTokens:v.number(),inputBound:v.optional(v.number()),outputAllowance:v.optional(v.number())},handler:async(ctx,a)=>{
  const existing=await ctx.db.query('modelRequests').withIndex('key',q=>q.eq('key',a.key)).unique();
  if(existing)return {existing};
  const now=Date.now();
  if(a.provider==='groq'){
    const s=await ctx.db.query('modelSettings').first()??defaults;
    if(s.tpm>0&&a.estimatedTokens>s.tpm)throw new Error(`Prompt estimate (${a.estimatedTokens} tokens including output allowance) exceeds the configured per-minute budget (${s.tpm}). Shorten context or adjust the limit.`);
    if((s.cooldownUntil??0)>now)return {waitMs:Math.min(2000,s.cooldownUntil!-now)};
    if(s.dailyRequests>0){
      const dayStart=Math.floor(now/86400000)*86400000;
      const day=await ctx.db.query('modelRequests').withIndex('provider_time',q=>q.eq('provider','groq').gte('startedAt',dayStart)).take(1001);
      if(day.length>=s.dailyRequests)throw new Error('Daily Groq request cap reached. Wait until the next UTC day or adjust the cap.');
    }
    const minute=await ctx.db.query('modelRequests').withIndex('provider_time',q=>q.eq('provider','groq').gt('startedAt',now-60000)).order('desc').take(100);
    if(minute.some(r=>r.status==='running'&&r.startedAt>now-65000)||(s.rpm>0&&minute.length>=s.rpm)||(s.tpm>0&&minute.reduce((n,r)=>n+(r.inputTokens!==undefined?r.inputTokens+(r.outputTokens??0):r.estimatedTokens),0)+a.estimatedTokens>s.tpm))return {waitMs:1500};
  }
  const {inputBound,outputAllowance,...record}=a;
  const budget=a.provider==='groq'?await ctx.db.query('modelBudgets').first():null;
  let costFields:Partial<{budgetId:Id<'modelBudgets'>;reservedMicros:number;inputPrice:number;outputPrice:number}>={};
  if(budget){
    const price=MODEL_PRICES[a.model];if(!price)throw new Error('No verified price for this model; request blocked.');
    if(inputBound===undefined||outputAllowance===undefined||!Number.isSafeInteger(inputBound)||!Number.isSafeInteger(outputAllowance)||inputBound<1||outputAllowance<1)throw new Error('Missing safe token reservation; request blocked.');
    const amount=costMicros(inputBound,outputAllowance,price);
    assertBudget(budget.limitMicros,budget.safetyMicros,budget.spentMicros,budget.reservedMicros,amount);
    await ctx.db.patch(budget._id,{reservedMicros:budget.reservedMicros+amount});
    costFields={budgetId:budget._id,reservedMicros:amount,inputPrice:price.input,outputPrice:price.output};
  }
  const id=await ctx.db.insert('modelRequests',{...record,...costFields,status:'running',startedAt:now});return {id};
}});
export const finish=internalMutation({args:{id:v.id('modelRequests'),status:v.string(),content:v.optional(v.string()),ms:v.number(),inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number()),reasoningTokens:v.optional(v.number()),httpStatus:v.optional(v.number()),providerError:v.optional(v.object({message:v.optional(v.string()),code:v.optional(v.string()),type:v.optional(v.string()),param:v.optional(v.string())})),providerRequestId:v.optional(v.string()),error:v.optional(v.string()),remainingRequests:v.optional(v.number()),remainingTokens:v.optional(v.number()),retryAfterSeconds:v.optional(v.number())},handler:async(ctx,{id,...a})=>{
  const previous=await ctx.db.get(id);if(!previous||previous.status!=='running')return;
  let costFields:{}|{chargedMicros:number;costBasis:string}={};
  if(previous.budgetId){
    const budget=await ctx.db.get(previous.budgetId);
    if(!budget)throw new Error('Missing request budget.');
    const known=a.inputTokens!==undefined&&a.outputTokens!==undefined;
    const charged=known?costMicros(a.inputTokens!,a.outputTokens!,{input:previous.inputPrice!,output:previous.outputPrice!}):previous.reservedMicros??0;
    await ctx.db.patch(budget._id,{spentMicros:budget.spentMicros+charged,reservedMicros:Math.max(0,budget.reservedMicros-(previous.reservedMicros??0))});
    costFields={chargedMicros:charged,costBasis:known?'reported tokens at list price':'conservative reservation; usage unavailable'};
  }
  await ctx.db.patch(id,{...a,...costFields,finishedAt:Date.now()});
  if(a.httpStatus===429){const s=await ctx.db.query('modelSettings').first();if(s)await ctx.db.patch(s._id,{cooldownUntil:Date.now()+Math.max(1000,(a.retryAfterSeconds??60)*1000)});}
}});
export const catalog=action({args:{},handler:async()=>{
  const key=process.env.GROQ_API_KEY;if(!key)throw new Error('GROQ_API_KEY is not configured in the backend.');
  const r=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`Groq model list returned HTTP ${r.status}. Check the key and provider status.`);
  const data=await r.json();
  return (data.data as {id:string;active?:boolean;context_window?:number}[]).filter(m=>m.active!==false&&!/whisper|orpheus|guard|tts/i.test(m.id)).map(m=>({id:m.id,context:m.context_window})).sort((a,b)=>a.id.localeCompare(b.id));
}});
export const testConnection=action({args:{},handler:async ctx=>{
  const config=await ctx.runQuery(internal.modelSettings.plan,{actor:'Connection test'});
  if(config.provider!=='groq')throw new Error('Save Groq as the provider before testing.');
  return modelReply(ctx,{actor:'Connection test',scope:'connection',requestKey:`test:${crypto.randomUUID()}`,maxTokens:128,messages:[{role:'user',content:'Reply with exactly the word Connected. Do not add anything else.'}]});
}});
