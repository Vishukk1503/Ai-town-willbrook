import {residentActivity} from '../src/components/residentActivity';
test('expired activities stop displaying, and running operations show their actual phase',()=>{
  const state={running:true,now:60000,activity:{description:'tending seedlings',until:1000}};
  expect(residentActivity(state)).toBe('Taking a moment');
  expect(residentActivity({...state,activity:{description:'tending seedlings',until:61000}})).toBe('tending seedlings');
  expect(residentActivity({...state,operation:{name:'agentGenerateMessage',started:15000}})).toBe('Waiting for a reply · 45s');
  expect(residentActivity({...state,membership:'walkingOver'})).toBe('Meeting a neighbor');
  expect(residentActivity({...state,running:false,typing:true})).toBe('World paused');
  expect(residentActivity({...state,manualMove:{destination:{x:4,y:3}},pathfinding:{}})).toBe('Walking to the spot you selected');
});
