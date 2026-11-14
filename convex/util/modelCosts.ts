// Standard on-demand prices checked against Groq's model documentation, 2026-11-08.
// Do not assume cache discounts. Estimates are not the provider invoice.
export const PRICE_DATE='2026-11-08';
export const MODEL_PRICES:Record<string,{input:number;output:number}>={
  'qwen/qwen3.8-27b':{input:.8,output:4},
  'openai/gpt-oss-20b':{input:.075,output:.3},
  'openai/gpt-oss-120b':{input:.15,output:.6},
};
export function costMicros(inputTokens:number,outputTokens:number,price:{input:number;output:number}){
  if(![inputTokens,outputTokens,price.input,price.output].every(n=>Number.isFinite(n)&&n>=0))throw new Error('Invalid cost inputs.');
  // USD / million tokens multiplied by tokens equals micro-USD.
  return Math.ceil(inputTokens*price.input+outputTokens*price.output);
}
export function inputTokenBound(messages:{role:string;content:string|null}[]){
  // Byte-level upper estimate, including generous per-message/template overhead.
  // Unlike chars/4 pacing, this does not depend on English token density.
  return new TextEncoder().encode(JSON.stringify(messages)).length+256*(messages.length+1);
}
export function assertBudget(limit:number,safety:number,spent:number,reserved:number,next:number){
  if(spent+reserved+next>limit-safety)throw new Error('The app spending budget is exhausted or reserved. New Groq calls are blocked; local activities remain available.');
}
