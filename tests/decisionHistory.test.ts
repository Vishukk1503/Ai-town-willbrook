import {Game} from '../convex/aiTown/game';
import {agentInputs} from '../convex/aiTown/agentInputs';
import {probe,observeTick,JournalEvent} from '../convex/aiTown/decisionJournal';
import {persistDecisionEvents} from '../convex/decisionHistoryStore';
import {emptyItems} from '../convex/aiTown/economyState';
import {livelihood} from '../convex/aiTown/livelihoodState';
function fixture(){
 const life=livelihood(['p:0'],0);life.needs[0].hunger=70;life.needs[0].energy=50;
 return new Game({} as any,'world' as any,{world:{nextId:100,clock:{elapsedMs:0},players:[{id:'p:0',position:{x:2,y:3},facing:{dx:1,dy:0},speed:0,lastInput:100000}],agents:[{id:'a:0',playerId:'p:0'}],conversations:[],livelihood:life,garden:{owner:'p:0',home:{x:2,y:5},origin:{x:0,y:0},time:0,seeds:0,food:0,nextJob:0,beds:[],events:[],nextEvent:0},economy:{merchant:'p:1',fisher:'p:0',market:{x:5,y:5},bank:{x:8,y:3},water:{x:9,y:3},bags:[{owner:'p:0',items:{...emptyItems(),meals:2,rod:1}}],marketStock:emptyItems(),population:2,lastRecovery:0,rng:12345,jobs:[],nextFish:0,events:[],nextEvent:0}},worldMap:{width:20,height:20,objectTiles:[],bgTiles:[],tileSetUrl:'',tileSetDimX:1,tileSetDimY:1,tileDim:16,animatedSprites:[]},playerDescriptions:[{playerId:'p:0',name:'Lucky',description:'Fisher',character:'f1'}],agentDescriptions:[]} as any);
}
function choose(g:Game,action:string,key:string,now=100000){const a=[...g.world.agents.values()][0];a.inProgressOperation={name:'agentChooseAction',operationId:key,started:now};agentInputs.finishDecision.handler(g,now,{agentId:a.id,operationId:key,action,reason:'A stated motive',source:'model'});}
function database(){
 const tables:Record<string,any[]>={decisionAudits:[],decisionEvents:[]};let counter=0;
 const db:any={query:(table:string)=>{let filters:Record<string,unknown>={};const q:any={withIndex:(_name:string,fn:any)=>{const index:any={eq:(key:string,value:unknown)=>{filters[key]=value;return index;}};fn(index);return q;},collect:async()=>tables[table].filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v)),unique:async()=>{const rows=await q.collect();if(rows.length>1)throw Error('duplicate unique key');return rows[0]??null;}};return q;},insert:async(table:string,value:any)=>{const id=table+':'+counter++;tables[table].push({...value,_id:id});return id;},get:async(id:string)=>Object.values(tables).flat().find(r=>r._id===id),patch:async(id:string,value:any)=>Object.assign(Object.values(tables).flat().find(r=>r._id===id),value)};
 return {ctx:{db} as any,tables};
}
test('captures two choices within one step and keeps pre-eating needs separate from the measured result',async()=>{
 const g=fixture();choose(g,'eat:meals','o:eat');const chosen=g.world.livelihood!.needs[0].hunger;
 for(let now=100000;now<=102100;now+=16){g.numPathfinds=0;g.tick(now);g.pendingOperations=[];}
 expect(g.world.livelihood!.needs[0].hunger).toBeLessThan(40);
 choose(g,'rest','o:rest',102101);const diff=g.takeDiff() as any,events=diff.decisionEvents as JournalEvent[];
 expect(events.filter(e=>e.phase==='selection').map(e=>e.key)).toEqual(['o:eat','o:rest']);
 expect(JSON.parse(events.find(e=>e.key==='o:eat'&&e.choice)!.choice!.bodyJson).needs.hunger).toBe(chosen);
 expect(events.find(e=>e.key==='o:eat'&&e.phase==='evidence')?.status).toBe('completed');
 const {ctx,tables}=database();await persistDecisionEvents(ctx,'world' as any,events);await persistDecisionEvents(ctx,'world' as any,events);
 expect(tables.decisionAudits).toHaveLength(2);expect(tables.decisionAudits.find(r=>r.operationId==='o:eat').status).toBe('completed');
 expect(tables.decisionEvents.filter(r=>r.operationId==='o:eat'&&r.phase==='evidence')).toHaveLength(1);
 expect(tables.decisionEvents.some(r=>r.playerId==='*'&&r.phase==='eat')).toBe(true);
 expect(g.decisionEvents).toHaveLength(0);
});
test('a failed catch is failure evidence, never a fabricated success',async()=>{
 const g=fixture();choose(g,'fish','o:fish');const before=probe(g);g.world.economy!.events.push({id:0,at:100001,kind:'fish',text:'Lucky did not catch a fish.',witnesses:['p:0']});g.world.economy!.nextEvent=1;
 observeTick(g,before,100001);const {ctx,tables}=database();await persistDecisionEvents(ctx,'world' as any,g.decisionEvents);
 expect(tables.decisionAudits[0].status).toBe('failed');expect(g.world.economy!.bags[0].items.fish).toBe(0);
});
test('a route stopped before arrival is unverified, not completed',async()=>{
 const g=fixture();choose(g,'walk:river','o:walk');const before=probe(g);delete g.world.players.get('p:0' as any)!.pathfinding;
 observeTick(g,before,100001);const {ctx,tables}=database();await persistDecisionEvents(ctx,'world' as any,g.decisionEvents);expect(tables.decisionAudits[0].status).toBe('unverified');
});
test('related agreement completion survives supersession and produces a single outcome receipt',async()=>{
 const {ctx,tables}=database();const base={playerId:'p:0',at:1,clock:0,key:'o:offer'};
 const events:JournalEvent[]=[{...base,phase:'selection',summary:'Accepted proposal',status:'accepted',relatedKey:'offer:9',choice:{requestedAction:'offer',actionId:'offer',kind:'offer',label:'Offer goods',reason:'Trade',source:'model',bodyJson:'{}',menuJson:'[]'}},{...base,at:2,phase:'superseded',summary:'Changed current activity',status:'interrupted'},{...base,key:'link:offer:9',playerId:'*',at:3,phase:'completed',summary:'The actual exchange completed.',status:'completed',relatedKey:'offer:9'}];
 await persistDecisionEvents(ctx,'world' as any,events);await persistDecisionEvents(ctx,'world' as any,events);
 expect(tables.decisionAudits[0].status).toBe('completed');expect(tables.decisionEvents.filter(e=>e.operationId==='o:offer'&&e.phase==='completed')).toHaveLength(1);
});
test('old intentions are labelled as preexisting and never receive invented choice-time needs',()=>{
 const g=fixture(),a=[...g.world.agents.values()][0];a.decision={kind:'walk',label:'Old walk',reason:'Old motive',source:'model',chosenAt:90000,until:200000};a.nextDecisionAt=200000;
 g.tick(100000);const first=g.decisionEvents.find(e=>e.choice)!;expect(first.phase).toBe('observed_existing');expect(first.choice!.source).toBe('preexisting');expect(first.choice!.bodyJson).toBe('{}');expect(a.decision?.needsAtChoice).toBeUndefined();
});
test('an exhaustion safeguard is recorded once, rather than once per simulation tick',()=>{
 const g=fixture();g.world.livelihood!.needs[0].energy=5;g.world.livelihood!.needs[0].hunger=20;
 for(let i=0;i<100;i++){g.tick(100000+i*16);g.pendingOperations=[];}
 expect(g.decisionEvents.filter(e=>e.phase==='selection'&&e.choice?.source==='engine')).toHaveLength(1);
});
