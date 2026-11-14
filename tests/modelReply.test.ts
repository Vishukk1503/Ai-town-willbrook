import {getFunctionName} from 'convex/server';
import {modelReply} from '../convex/modelReply';
const request={actor:'Bob',scope:'town',requestKey:'one-operation',messages:[{role:'user',content:'Hello'}]};
function context(active=()=>true,existing?:any){
  const logs:any[]=[];
  const ctx={
    runQuery:async(ref:any)=>getFunctionName(ref).endsWith(':plan')?{provider:'groq',chosenModel:'test',hasKey:true,maxTokens:256}:active(),
    runMutation:async(ref:any,a:any)=>{if(getFunctionName(ref).endsWith(':reserve'))return existing?{existing}:{id:'request'};logs.push(a);return null;},
  } as any;return {ctx,logs};
}
const originalFetch=globalThis.fetch;
const originalKey=process.env.GROQ_API_KEY;
beforeEach(()=>{process.env.GROQ_API_KEY='mock-key';});
afterEach(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=originalKey;});
test('a completed duplicate returns its saved result without another provider request',async()=>{
  const {ctx}=context(()=>true,{status:'complete',content:'Already generated',ms:15});
  let count=0;globalThis.fetch=(async()=>{count++;throw new Error('Unexpected network request');}) as typeof fetch;
  expect(await modelReply(ctx,request)).toMatchObject({content:'Already generated'});expect(count).toBe(0);
});
test('an ended conversation cancels the request before sending context',async()=>{
  const {ctx}=context(()=>false);let count=0;globalThis.fetch=(async()=>{count++;throw new Error('Unexpected network request');}) as typeof fetch;
  await expect(modelReply(ctx,request)).rejects.toThrow('cancelled');expect(count).toBe(0);
});
test('cancellation during generation aborts fetch and records no committed content',async()=>{
  let checks=0;const {ctx,logs}=context(()=>++checks<2);
  globalThis.fetch=((_url:any,options:any)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('Aborted')));})) as typeof fetch;
  await expect(modelReply(ctx,request)).rejects.toThrow('cancelled');expect(logs.at(-1)).toMatchObject({status:'cancelled'});expect(logs.at(-1).content).toBeUndefined();
});
test('ambiguous server errors are not automatically repeated',async()=>{
  const {ctx,logs}=context();let count=0;
  globalThis.fetch=(async()=>{count++;return new Response('server error',{status:500});}) as typeof fetch;
  await expect(modelReply(ctx,request)).rejects.toThrow('HTTP 500');expect(count).toBe(1);expect(logs[0]).toMatchObject({status:'error',httpStatus:500});
});
test.each(['intent','speech'] as const)('%s stage receives its own contract and requested token limit',async outputContract=>{
 const {ctx}=context();let sent:any;
 globalThis.fetch=(async(_url,options)=>{sent=JSON.parse(options!.body as string);return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}),{status:200});}) as typeof fetch;
 await modelReply(ctx,{...request,scope:'prototype-'+outputContract,outputContract,maxTokens:128,responseSchema:{type:'object'},messages:[{role:'system',content:'Approved intention only.'}]});
 expect(sent.max_completion_tokens).toBe(128);
 const prompt=sent.messages.map((m:any)=>m.content).join('\n');
 expect(prompt).not.toContain('continuation fields');expect(prompt).not.toContain('Add your own concrete preference');
 expect(prompt.includes('VOICE:')).toBe(outputContract==='speech');
});
test('prototype stages never hide an extra provider call on rate limiting',async()=>{
 const {ctx,logs}=context();let count=0;
 globalThis.fetch=(async()=>{count++;return new Response('rate limited',{status:429,headers:{'retry-after':'1'}});}) as typeof fetch;
 await expect(modelReply(ctx,{...request,outputContract:'intent'})).rejects.toThrow('rate limit');
 expect(count).toBe(1);expect(logs[0]).toMatchObject({status:'error',httpStatus:429});
});


test('one-call town errors retain provider diagnostics without raw failed generation or credentials',async()=>{
 const {ctx,logs}=context();let calls=0;
 globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({error:{message:'Invalid schema for mock-key',type:'invalid_request_error',code:'invalid_schema',param:'response_format',failed_generation:'private generated text'}}),{status:400,headers:{'x-request-id':'req-400'}});}) as typeof fetch;
 await expect(modelReply(ctx,{...request,scope:'town-joint',outputContract:'speech'})).rejects.toThrow('Invalid schema for [REDACTED]');
 expect(calls).toBe(1);
 expect(logs[0]).toMatchObject({status:'error',httpStatus:400,providerRequestId:'req-400',providerError:{message:'Invalid schema for [REDACTED]',type:'invalid_request_error',code:'invalid_schema',param:'response_format'}});
 expect(JSON.stringify(logs)).not.toContain('mock-key');
 expect(JSON.stringify(logs)).not.toContain('private generated text');
});
