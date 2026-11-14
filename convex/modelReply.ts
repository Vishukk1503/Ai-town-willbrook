import {dialogueDirection,dialogueVoice} from '../data/dialogue';
import {inputTokenBound} from './util/modelCosts';
import {ActionCtx} from './_generated/server';
import {Id,Doc} from './_generated/dataModel';
import {internal} from './_generated/api';
import {requestModel,estimateTokens,Message,ModelError} from './util/modelTransport';
type Validity={worldId?:Id<'worlds'>;operationId?:string;sessionId?:Id<'councilSessions'>;expected?:number;attempt?:number};
export async function modelReply(ctx:ActionCtx,a:{actor:string;scope:string;requestKey:string;messages:Message[];maxTokens?:number;responseSchema?:Record<string,unknown>;outputContract?:'intent'|'speech';validity?:Validity}):Promise<{content:string;provider:string;ms:number}>{
  const config=await ctx.runQuery(internal.modelSettings.plan,{actor:a.actor});
  if(config.provider==='groq'&&!config.hasKey)throw new Error('Configure GROQ_API_KEY in the backend before enabling Groq.');
  const maxTokens=a.outputContract?Math.min(a.maxTokens??256,config.maxTokens):a.scope==='connection'?128:a.scope==='action'?Math.min(a.maxTokens??768,config.maxTokens):config.provider==='groq'?config.maxTokens:Math.min(a.maxTokens??config.maxTokens,config.maxTokens),validity=a.validity??{};
  const messages=[...a.messages];
  if(a.scope!=='connection'&&a.scope!=='action'&&a.outputContract!=='intent'){
    const guidance=a.outputContract==='speech'?dialogueVoice(a.actor):dialogueDirection(a.actor);
    const index=messages.findIndex(m=>m.role==='system');
    if(index>=0)messages[index]={...messages[index],content:(messages[index].content??'')+guidance};
    else messages.unshift({role:'system',content:`You are ${a.actor}.${guidance}`});
  }
  if(a.responseSchema){const index=messages.findIndex(m=>m.role==='system');messages[index]={...messages[index],content:messages[index].content+(a.outputContract?'\nOUTPUT CONTRACT: return only the supplied JSON schema. No extra fields.':a.scope==='action'?'\nOUTPUT CONTRACT: return only the supplied action JSON schema. Use plan:null and abandonPlan:false unless changing plans.':'\nOUTPUT CONTRACT: return only the supplied JSON schema. Apply voice instructions exclusively inside speech; include intent and continuation fields. Never output an [END] marker.')};}
  const accountingMessages=a.responseSchema?[...messages,{role:'system',content:JSON.stringify(a.responseSchema)}]:messages;
  const isActive=()=>ctx.runQuery(internal.modelSettings.active,validity);
  const started=Date.now(),deadline=started+(a.scope==='action'?5000:110000);
  for(let attempt=0;attempt<2;attempt++){
    let reservation:{id?:Id<'modelRequests'>;waitMs?:number;existing?:Doc<'modelRequests'>};
    while(true){
      if(!await isActive())throw new Error('Request cancelled because the conversation ended or was paused.');
      if(Date.now()>deadline)throw new Error('Request queue timed out. Free-tier pacing is busy; retry after the current request.');
      reservation=await ctx.runMutation(internal.modelSettings.reserve,{key:`${a.requestKey}:${attempt}`,provider:config.provider,model:config.chosenModel,actor:a.actor,scope:a.scope,sessionId:validity.sessionId,estimatedTokens:estimateTokens(accountingMessages,maxTokens),inputBound:inputTokenBound(accountingMessages),outputAllowance:maxTokens});
      if(reservation.existing){
        const previous=reservation.existing;
        if(previous.status==='complete'&&previous.content)return {content:previous.content,provider:config.provider,ms:previous.ms??0};
        if(previous.status!=='running')throw new Error(previous.error??'This request already finished without a reply. Start a fresh turn to retry.');
      }else if(reservation.id)break;
      await new Promise(resolve=>setTimeout(resolve,reservation.waitMs??1000));
    }
    const id=reservation.id!;const controller=new AbortController();let done=false,cancelled=false,timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},a.scope==='action'?8000:config.provider==='groq'?45000:110000);
    const callStarted=Date.now();
    const request=requestModel({provider:config.provider,model:config.chosenModel,messages,maxTokens,responseSchema:a.responseSchema,key:process.env.GROQ_API_KEY,signal:controller.signal}).then(value=>({value}),error=>({error})).finally(()=>{done=true;});
    try{
      while(!done){await new Promise<void>(resolve=>{const timer=setTimeout(resolve,1000);void request.then(()=>{clearTimeout(timer);resolve();});});if(!done&&!await isActive()){cancelled=true;controller.abort();}}
      const result=await request;
      if('error' in result)throw result.error;
      if(result.value.content.toLowerCase().replace(/[^a-z0-9]/g,'')===a.actor.toLowerCase().replace(/[^a-z0-9]/g,''))throw new ModelError('The model returned only the character’s name. No reply was committed.',result.value);
      if(!await isActive()){
        cancelled=true;const {content,...usage}=result.value;
        await ctx.runMutation(internal.modelSettings.finish,{id,status:'cancelled',...usage,error:'Conversation ended; generated reply discarded.',ms:Date.now()-callStarted});
        throw new Error('Cancelled after generation; reply was discarded.');
      }
      await ctx.runMutation(internal.modelSettings.finish,{id,status:'complete',...result.value,ms:Date.now()-callStarted});
      return {content:result.value.content,provider:config.provider,ms:Date.now()-started};
    }catch(error){
      const details=error instanceof ModelError?error.details:{};
      const message=cancelled?'Request cancelled; no dialogue or memory was committed.':timedOut?'Model request timed out; it was not automatically repeated to avoid duplicate billing.':error instanceof Error?error.message:'Model request failed.';
      await ctx.runMutation(internal.modelSettings.finish,{id,status:cancelled?'cancelled':'error',...details,error:message,ms:Date.now()-callStarted});
      if(!a.outputContract&&a.scope!=='action'&&attempt===0&&details.httpStatus===429&&(details.retryAfterSeconds??60)<=5){await new Promise(resolve=>setTimeout(resolve,Math.max(1000,(details.retryAfterSeconds??1)*1000)));continue;}
      throw new Error(message);
    }finally{clearTimeout(timeout);controller.abort();}
  }
  throw new Error('Model retry limit reached.');
}
