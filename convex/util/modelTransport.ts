export type Message={role:string;content:string|null};
export type ProviderError={message?:string;code?:string;type?:string;param?:string};
export type Reply={content:string;providerError?:ProviderError;providerRequestId?:string;inputTokens?:number;outputTokens?:number;reasoningTokens?:number;remainingRequests?:number;remainingTokens?:number;retryAfterSeconds?:number;httpStatus?:number};
export class ModelError extends Error{
  constructor(message:string,public details:Partial<Reply>={}){super(message);}
}
export function estimateTokens(messages:Message[],maxTokens:number){return Math.ceil(JSON.stringify(messages).length/4)+maxTokens;}
export function retryDelay(value:string|null,now=Date.now()){
  if(!value)return 60;const numeric=Number(value);return Number.isFinite(numeric)?Math.max(0,numeric):Math.max(0,(Date.parse(value)-now)/1000)||60;
}
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
export async function requestModel(a:{provider:'local'|'groq';model:string;messages:Message[];maxTokens:number;key?:string;responseSchema?:Record<string,unknown>;signal:AbortSignal},fetcher:typeof fetch=fetch):Promise<Reply>{
  if(a.provider==='groq'&&!a.key)throw new ModelError('GROQ_API_KEY is not configured.');
  const local=a.provider==='local';
  const reasoning=a.model==='qwen/qwen3.8-27b'?{reasoning_effort:'none'}:/^openai\/gpt-oss-(20b|120b)$/.test(a.model)?{reasoning_effort:'low'}:{};
  const response=await fetcher(local?(process.env.OLLAMA_HOST??'http://127.0.0.1:11434')+'/api/chat':'https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',...(!local?{Authorization:`Bearer ${a.key}`}:{})},signal:a.signal,
    body:JSON.stringify(local?{model:a.model,messages:a.messages,...(a.responseSchema?{format:a.responseSchema}:{}),think:false,stream:false,keep_alive:'2m',options:{num_predict:a.maxTokens,num_ctx:8192,temperature:.8}}:{model:a.model,messages:a.messages.map(m=>({role:['system','assistant'].includes(m.role)?m.role:'user',content:m.content??''})),max_completion_tokens:a.maxTokens,temperature:.8,stream:false,...(a.responseSchema?{response_format:['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b'].includes(a.model)?{type:'json_schema',json_schema:{name:'resident_dialogue',strict:true,schema:a.responseSchema}}:{type:'json_object'}}:{}),...reasoning}),
  });
  const headerNumber=(name:string)=>{const s=response.headers.get(name);return s===null?undefined:number(Number(s));};
  const details:Partial<Reply>={httpStatus:response.status,remainingRequests:headerNumber('x-ratelimit-remaining-requests'),remainingTokens:headerNumber('x-ratelimit-remaining-tokens')};
  if(!response.ok){
    if(response.status===429)details.retryAfterSeconds=retryDelay(response.headers.get('retry-after'));
    // Keep bounded diagnostic fields, not raw bodies, echoed prompts or failed generations.
    const safe=(value:unknown,max=1200)=>typeof value==='string'
      ? (a.key ? value.split(a.key).join('[REDACTED]') : value).slice(0,max) : undefined;
    const requestId=safe(response.headers.get('x-request-id')??response.headers.get('x-groq-request-id'),200);
    if(requestId)details.providerRequestId=requestId;
    try {
      const data=await response.json(),error=data?.error;
      if(error&&typeof error==='object'){
        const fields={message:safe(error.message),code:safe(error.code,160),type:safe(error.type,160),param:safe(error.param,160)};
        details.providerError=Object.fromEntries(Object.entries(fields).filter(([,v])=>v!==undefined));
      }
      if(!details.providerRequestId){const id=safe(data?.request_id??data?.x_groq?.id,200);if(id)details.providerRequestId=id;}
    } catch { /* Non-JSON provider failures still retain HTTP status and request ID. */ }
    const summary=response.status===429?'Groq rate limit reached. Requests will wait before retrying.':`${local?'Ollama':'Groq'} returned HTTP ${response.status}.`;
    throw new ModelError(summary+(details.providerError?.message?' '+details.providerError.message:''),details);
  }
  const data=await response.json();
  Object.assign(details,{inputTokens:number(local?data.prompt_eval_count:data.usage?.prompt_tokens),outputTokens:number(local?data.eval_count:data.usage?.completion_tokens),reasoningTokens:number(data.usage?.completion_tokens_details?.reasoning_tokens)});
  const content=(local?data.message?.content:data.choices?.[0]?.message?.content)?.trim();
  if(!content)throw new ModelError('The model returned no spoken text. Try a different model or a larger completion limit.',details);
  if(!local&&data.choices?.[0]?.finish_reason==='length')throw new ModelError('The reply reached its completion limit. Raise the limit or choose a model with less reasoning overhead.',details);
  return {...details,content};
}
