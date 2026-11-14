import { recordSpeech, recallGraph, graphPrompt, recallCharacter } from '../convex/memoryGraph';
import { speechSignals } from '../convex/agent/memorySignals';
import { socialContext } from '../convex/social';
import { socialProfiles, startingRelationships } from '../data/socialProfiles';
import { chooseIntention } from '../convex/agent/socialRules';
import {recallActionPromises} from '../convex/agent/actionPromises';
import {buildActionContext,choose} from '../convex/residentActions';
import {getFunctionName} from 'convex/server';

function database() {
  const rows: Record<string, any[]> = {};
  const db = {
    async insert(table: string, value: any) {
      const list = rows[table] ??= [];
      const _id = `${table}:${list.length}`;
      list.push({...value, _id}); return _id;
    },
    async get(id: string) { return Object.values(rows).flat().find(r => r._id === id); },
    async patch(id:string,value:any){Object.assign(Object.values(rows).flat().find(r=>r._id===id),value);},
    query(table: string) {
      let matches = [...(rows[table] ?? [])];
      const query = {
        withIndex(_name: string, fn: any) {
          const index = {eq(key: string, value: any) { matches = matches.filter(r => r[key] === value); return index; }};
          fn(index); return query;
        },
        order(direction: string) { matches.sort((a,b) => direction==='asc'?a.occurredAt-b.occurredAt:b.occurredAt-a.occurredAt); return query; },
        async first() { return matches[0] ?? null; },
        async unique() { return matches[0] ?? null; },
        async take(n: number) { return matches.slice(0,n); },
        async collect() { return matches; },
      }; return query;
    },
  };
  return {ctx: {db} as any, rows};
}

test('action context pins an old promise despite newer chat and resolved promises',async()=>{
 const {ctx}=database();
 const worldId=await ctx.db.insert('worlds',{players:[{id:'bob',position:{x:1,y:1}}],agents:[{id:'a:0',playerId:'bob',inProgressOperation:{operationId:'op'}}],conversations:[]});
 const base={worldId,context:'Town',speaker:'bob',speakerName:'Bob',witnesses:['lucky']};
 await recordSpeech(ctx,{...base,source:'old',text:'I promise to bring seeds.',occurredAt:1});
 for(let i=0;i<35;i++){
  await recordSpeech(ctx,{...base,source:'p'+i,text:`I promise to do task ${i}.`,occurredAt:10+i*3});
  await recordSpeech(ctx,{...base,source:'r'+i,text:`I withdraw my promise to do task ${i}.`,occurredAt:11+i*3});
 }
 const data=await buildActionContext(ctx,{worldId,agentId:'a:0',operationId:'op'});
 expect(data?.memories.some(m=>m.text.includes('bring seeds'))).toBe(false);
 expect(data?.promiseMemory.pending).toEqual([expect.objectContaining({own:true,task:'bring seeds',status:'open',sourceEventId:expect.any(String)})]);
 await recordSpeech(ctx,{...base,source:'withdraw-old',text:'I withdraw my promise to bring seeds.',occurredAt:999});
 expect((await buildActionContext(ctx,{worldId,agentId:'a:0',operationId:'op'}))?.promiseMemory.pending).toEqual([]);
});

test('promise decisions respect witness scope, withdrawn sources and unverified completion claims',async()=>{
 const {ctx,rows}=database(),worldId='world' as any;
 const base={worldId,context:'Town',speaker:'bob',speakerName:'Bob',witnesses:['lucky']};
 await recordSpeech(ctx,{...base,source:'promise',text:'I promise to bring fish.',occurredAt:1});
 await recordSpeech(ctx,{...base,witnesses:[],source:'claim',text:'I kept my promise to bring fish.',occurredAt:2});
 const own=await recallActionPromises(ctx,worldId,'bob',[]);
 expect(own.pending).toEqual([]);expect(own.reportedDone[0].status).toBe('reported_done');
 expect((await recallActionPromises(ctx,worldId,'lucky',[])).pending[0]).toMatchObject({own:false,status:'open'});
 expect((await recallActionPromises(ctx,worldId,'stella',[])).pending).toEqual([]);
 expect((await recallActionPromises(ctx,'another-world' as any,'bob',[])).reportedDone).toEqual([]);
 rows.memoryEvents[1].inactive=true;
 expect((await recallActionPromises(ctx,worldId,'bob',[])).pending[0].task).toBe('bring fish');
 rows.memoryEvents[0].inactive=true;
 expect((await recallActionPromises(ctx,worldId,'bob',[])).pending).toEqual([]);
});

test('own promises rank ahead of heard promises; output is bounded with omissions disclosed',async()=>{
 const {ctx}=database(),worldId='world' as any;
 for(let i=0;i<10;i++)await recordSpeech(ctx,{worldId,source:'own'+i,context:'Town',speaker:'bob',speakerName:'Bob',witnesses:[],text:`I promise to ${i===9?'bring seeds':'complete errand '+i}.`,occurredAt:i});
 await recordSpeech(ctx,{worldId,source:'heard',context:'Town',speaker:'lucky',speakerName:'Lucky',witnesses:['bob'],text:'I promise to bring seeds.',occurredAt:100});
 const recalled=await recallActionPromises(ctx,worldId,'bob',['bring seeds']);
 expect(recalled.pending[0]).toMatchObject({own:true,task:'bring seeds'});
 expect(recalled.pending).toHaveLength(6);expect(recalled.omittedPending).toBe(5);expect(recalled.scanLimited).toBe(false);
});

test('the real action request sends promise context to the provider and retains it in the decision audit',async()=>{
 const {ctx}=database();
 const worldId=await ctx.db.insert('worlds',{players:[{id:'bob',position:{x:1,y:1}}],agents:[{id:'a:0',playerId:'bob',inProgressOperation:{operationId:'op'}}],conversations:[]});
 await recordSpeech(ctx,{worldId,source:'p',context:'Town',speaker:'bob',speakerName:'Bob',witnesses:[],text:'I promise to bring seeds.',occurredAt:1});
 const data=await buildActionContext(ctx,{worldId,agentId:'a:0',operationId:'op'});
 let body:any,audit:any;const mutations:any[]=[];
 const actionCtx={runQuery:async(ref:any)=>{const n=getFunctionName(ref);return n==='residentActions:context'?data:n==='modelSettings:plan'?{provider:'groq',chosenModel:'test',hasKey:true,maxTokens:256}:true;},runMutation:async(ref:any,args:any)=>{
  const n=getFunctionName(ref);mutations.push({n,args});if(n==='decisionHistory:begin'){audit=JSON.parse(args.contextJson);return args.contextJson;}if(n==='modelSettings:reserve')return {id:'req'};return null;
 }};
 const oldFetch=globalThis.fetch,oldKey=process.env.GROQ_API_KEY;process.env.GROQ_API_KEY='mock';
 globalThis.fetch=(async(_url:any,options:any)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({action:'wander',reason:'Look for a feasible way to obtain seeds'})}}],usage:{prompt_tokens:100,completion_tokens:20}}),{status:200});}) as typeof fetch;
 try{await (choose as any)._handler(actionCtx,{worldId,agentId:'a:0',operationId:'op'});}finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=oldKey;}
 const sent=JSON.parse(body.messages.find((m:any)=>m.role==='user').content);
 expect(sent.promiseMemory.pending[0].task).toBe('bring seeds');expect(audit.promiseMemory).toEqual(sent.promiseMemory);
 expect(body.messages[0].content).toContain('Someone else\'s promise is not your obligation');
 expect(mutations.some(m=>m.n==='aiTown/main:sendInput'&&m.args.args.action==='wander')).toBe(true);
});

test('one encounter creates distinct perspectives, excludes a non-witness, and is idempotent', async () => {
  const {ctx, rows} = database();
  const speech = {worldId: 'world' as any, source: 'town:real-message', context: 'Town conversation',
    speaker: 'bob', speakerName: 'Bob', text: 'I enjoy gardening.', witnesses: ['bob','lucky','lucky'], occurredAt: 1000};
  await recordSpeech(ctx, speech); await recordSpeech(ctx, speech);
  expect(rows.memoryEvents).toHaveLength(1);
  expect(rows.memoryPerspectives).toHaveLength(2);
  const own = await recallGraph(ctx, speech.worldId, 'bob');
  const heard = await recallGraph(ctx, speech.worldId, 'lucky');
  expect(own[0].kind).toBe('said'); expect(heard[0].kind).toBe('heard');
  expect(own[0].id).toBe(heard[0].id);
  expect(await recallGraph(ctx, speech.worldId, 'stella')).toEqual([]);
  expect(await recallGraph(ctx, 'another-world' as any, 'bob')).toEqual([]);
  expect(graphPrompt(heard)).toContain('claims, not verified facts');
  rows.memoryEvents[0].inactive = true;
  expect(await recallGraph(ctx, speech.worldId, 'bob')).toEqual([]);
  expect(rows.memoryEvents).toHaveLength(1);
});


test('belief corrections and promise resolutions stay attributed and respect what each witness heard',async()=>{
  const {ctx,rows}=database();
  const base={worldId:'world' as any,context:'Town conversation',speaker:'bob',speakerName:'Bob',witnesses:['lucky']};
  await recordSpeech(ctx,{...base,source:'a',text:'I believe the garden is closed.\nI promise to bring seeds.',occurredAt:1000});
  await recordSpeech(ctx,{...base,source:'b',witnesses:[],text:'I used to believe the garden is closed, but now I believe the garden is open.\nI kept my promise to bring seeds.',occurredAt:2000});
  const bob=await recallCharacter(ctx,base.worldId,'bob');
  const lucky=await recallCharacter(ctx,base.worldId,'lucky');
  expect(bob.beliefs.map(b=>b.statement)).toEqual(['the garden is open']);
  expect(bob.promises[0].status).toBe('reported_done');
  expect(lucky.beliefs[0].subject).toBe('bob');
  expect(lucky.beliefs[0].statement).toBe('the garden is closed');
  expect(lucky.promises[0].status).toBe('open');
  expect((await recallCharacter(ctx,base.worldId,'stella')).beliefs).toEqual([]);
  rows.memoryEvents[1].inactive=true;
  const retired=await recallCharacter(ctx,base.worldId,'bob');
  expect(retired.beliefs[0].statement).toBe('the garden is closed');
  expect(retired.promises[0].status).toBe('open');
});

test('suggestions, questions, quotations and hypothetical promises do not create commitments',()=>{
  expect(speechSignals('Maybe I will bring seeds.\nShould I promise to help?\nBob said: I promise to help.\nIf I promise to help, will you come?').promises).toEqual([]);
  expect(speechSignals('I promise to bring seeds.').promises).toEqual(['bring seeds']);
});

test('a social encounter creates asymmetric evidence and changes the next intention without granting trust',async()=>{
  const {ctx,rows}=database();
  for(const [name,id] of [['Lucky','lucky'],['Bob','bob'],['Stella','stella']]){
    await ctx.db.insert('playerDescriptions',{worldId:'world',playerId:id,name});
    await ctx.db.insert('characterSheets',{worldId:'world',playerId:id,name,...socialProfiles[name],source:'authored-v1'});
  }
  for(const [owner,target,name] of [['bob','lucky','Lucky'],['lucky','bob','Bob']]){
    const key=owner==='bob'?'Bob:Lucky':'Lucky:Bob';
    await ctx.db.insert('relationshipBaselines',{worldId:'world',owner,target,targetName:name,...startingRelationships[key],source:'authored-v1'});
  }
  const baseline=await socialContext(ctx,'world' as any,'bob');
  expect(baseline.relationships[0].choice?.intent).toBe('ask a grounded question');
  const event={worldId:'world' as any,source:'social:offer',context:'Town conversation',speaker:'lucky',speakerName:'Lucky',text:'Bob, I can help you carry those seeds.',witnesses:['bob'],occurredAt:Date.now()};
  await recordSpeech(ctx,event);await recordSpeech(ctx,event);
  const bob=await socialContext(ctx,event.worldId,'bob');
  const lucky=await socialContext(ctx,event.worldId,'lucky');
  expect(bob.relationships[0].scores.affection).toBe(46);
  expect(bob.relationships[0].scores.trust).toBe(35);
  expect(bob.relationships[0].choice?.intent).toBe('acknowledge the other person');
  expect(lucky.relationships[0].scores.affection).toBe(60);
  expect(lucky.relationships[0].choice?.intent).toBe('share an observation');
  expect((await socialContext(ctx,event.worldId,'stella')).relationships).toEqual([]);
  expect(rows.relationshipChanges).toHaveLength(2);
  for(let i=0;i<5;i++)await recordSpeech(ctx,{...event,source:`repeat:${i}`,occurredAt:event.occurredAt+i+1});
  expect((await socialContext(ctx,event.worldId,'bob')).relationships[0].scores.affection).toBe(46);
  for(const e of rows.memoryEvents)e.inactive=true;
  expect((await socialContext(ctx,event.worldId,'bob')).relationships[0].scores).toEqual(baseline.relationships[0].scores);
});

test('personality and relationship dimensions influence choices independently',()=>{
  const relationship=startingRelationships['Bob:Lucky'].scores;
  expect(chooseIntention(socialProfiles.Bob.traits,relationship).intent).toBe('ask a grounded question');
  expect(chooseIntention(socialProfiles.Lucky.traits,relationship).intent).toBe('share an observation');
  expect(chooseIntention(socialProfiles.Bob.traits,{...relationship,tension:100}).intent).toBe('state a gentle boundary');
});

test('group speech needs an explicit addressee and a decline does not reduce trust',async()=>{
  const {ctx,rows}=database();
  for(const [name,playerId] of [['Bob','bob'],['Lucky','lucky'],['Stella','stella']])await ctx.db.insert('playerDescriptions',{worldId:'world',name,playerId});
  const event={worldId:'world' as any,source:'group:1',context:'Council conversation',speaker:'lucky',speakerName:'Lucky',text:'I can help you carry seeds.',witnesses:['bob','stella'],occurredAt:Date.now()};
  await recordSpeech(ctx,event);
  expect(rows.relationshipChanges??[]).toHaveLength(0);
  await recordSpeech(ctx,{...event,source:'group:2',text:'Bob, I cannot help today.'});
  expect(rows.relationshipChanges).toHaveLength(2);
  expect(rows.relationshipChanges.every(c=>c.owner!=='stella'&&c.target!=='stella')).toBe(true);
  expect(rows.relationshipChanges.every(c=>c.delta.trust===undefined&&c.delta.affection===undefined)).toBe(true);
});


test('structured-action dialogue stores speech without deriving regex promises or social claims',async()=>{
 const {ctx,rows}=database();
 await recordSpeech(ctx,{worldId:'world' as any,source:'joint-test',context:'Town',speaker:'bob',speakerName:'Bob',text:'I promise to bring fish. Leave me alone.',witnesses:['lucky'],occurredAt:1},false);
 expect(rows.memoryEvents[0].text).toBe('I promise to bring fish. Leave me alone.');
 expect(rows.memoryPerspectives).toHaveLength(2);expect(rows.characterPromises??[]).toHaveLength(0);expect(rows.relationshipChanges??[]).toHaveLength(0);
 expect(rows.memoryEvents[0].signalsProcessed).toBe(true);
});
