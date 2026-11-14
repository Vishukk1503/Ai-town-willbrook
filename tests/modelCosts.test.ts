import {MODEL_PRICES,costMicros,inputTokenBound,assertBudget} from '../convex/util/modelCosts';
test('verified prices give separate input/output costs without double-counting reasoning',()=>{
  expect(costMicros(2000,200,MODEL_PRICES['qwen/qwen3.8-27b'])).toBe(2400);
  expect(costMicros(2000,200,MODEL_PRICES['openai/gpt-oss-20b'])).toBe(210);
  expect(costMicros(2000,200,MODEL_PRICES['openai/gpt-oss-120b'])).toBe(420);
  // Completion usage already includes reasoning; there is no separate reasoning charge.
  expect(costMicros(84,25,MODEL_PRICES['openai/gpt-oss-120b'])).toBe(28);
});
test('reservation accounts for dense and multilingual prompts rather than assuming four characters per token',()=>{
  for(const content of ['Hello',String.fromCodePoint(0x1f31f).repeat(50),'a'.repeat(10000)]){
    const messages=[{role:'user',content}];
    expect(inputTokenBound(messages)).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(messages)).length);
  }
});
test('spending plus concurrent reservations cannot consume the protected safety reserve',()=>{
  expect(()=>assertBudget(5000000,500000,4400000,90000,10000)).not.toThrow();
  expect(()=>assertBudget(5000000,500000,4400000,100000,1)).toThrow('budget');
  expect(()=>assertBudget(5000000,500000,4500000,0,1)).toThrow('budget');
});
test('invalid costs fail closed and fractional micro-dollar costs round upwards',()=>{
  expect(costMicros(1,0,MODEL_PRICES['openai/gpt-oss-20b'])).toBe(1);
  for(const n of [-1,NaN,Infinity])expect(()=>costMicros(n,10,MODEL_PRICES['openai/gpt-oss-20b'])).toThrow();
});
