import {requestModel,ModelError,estimateTokens,retryDelay} from '../convex/util/modelTransport';
const args={provider:'groq' as const,model:'test-model',key:'test-secret-not-real',messages:[{role:'user',content:'Hello'}],maxTokens:256,signal:new AbortController().signal};
test('hosted requests use the backend credential and preserve provider usage without double-counting reasoning',async()=>{
  let sent:any;
  const result=await requestModel(args,(async(url,options)=>{sent={url,options};return new Response(JSON.stringify({choices:[{message:{content:'Hello, neighbor.'},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:40,completion_tokens_details:{reasoning_tokens:10}}}),{headers:{'x-ratelimit-remaining-tokens':'456','x-ratelimit-remaining-requests':'8'}});}) as typeof fetch);
  expect(sent.url).toBe('https://api.groq.com/openai/v1/chat/completions');
  expect(sent.options.headers.Authorization).toBe('Bearer test-secret-not-real');
  expect(JSON.parse(sent.options.body)).toMatchObject({model:'test-model',max_completion_tokens:256,stream:false});
  expect(sent.options.body).not.toContain('test-secret-not-real');
  expect(result).toMatchObject({content:'Hello, neighbor.',inputTokens:123,outputTokens:40,reasoningTokens:10,remainingTokens:456,remainingRequests:8});
});
test('rate-limit failures report retry-after and never echo provider response bodies',async()=>{
  try{await requestModel(args,(async()=>new Response('do not echo test-secret-not-real',{status:429,headers:{'retry-after':'3'}})) as typeof fetch);throw new Error('Should fail');}
  catch(e){expect(e).toBeInstanceOf(ModelError);expect((e as ModelError).details).toMatchObject({httpStatus:429,retryAfterSeconds:3});expect((e as Error).message).not.toContain('test-secret');}
  expect(retryDelay(null)).toBe(60);
});
test('empty and truncated responses are rejected, while usage remains available',async()=>{
  for(const content of ['', 'unfinished']){
    try{await requestModel(args,(async()=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:content?'length':'stop'}],usage:{prompt_tokens:5,completion_tokens:256}}))) as typeof fetch);throw new Error('Should fail');}
    catch(e){expect(e).toBeInstanceOf(ModelError);expect((e as ModelError).details.outputTokens).toBe(256);}
  }
});
test('missing keys fail before network access; local requests omit authorization',async()=>{
  let called=false;
  await expect(requestModel({...args,key:undefined},(async()=>{called=true;return new Response();}) as typeof fetch)).rejects.toThrow('not configured');
  expect(called).toBe(false);
  const r=await requestModel({...args,provider:'local'},(async(url,options)=>{expect(String(url)).toContain('/api/chat');expect(options?.headers).not.toHaveProperty('Authorization');return new Response(JSON.stringify({message:{content:'Local reply'},prompt_eval_count:50,eval_count:7}));}) as typeof fetch);
  expect(r).toMatchObject({content:'Local reply',inputTokens:50,outputTokens:7});
  expect(estimateTokens(args.messages,256)).toBeGreaterThan(256);
});
