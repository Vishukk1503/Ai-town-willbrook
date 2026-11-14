import {relevantMemories} from '../data/dialogue';

describe('conversation memory selection',()=>{
  const memories=[
    {description:'We discussed a river fishing trip',id:'recent'},
    {description:'Bob promised to water the garden',id:'garden'},
    {description:'Fishing at the river with Bob was peaceful',id:'river'},
  ];
  test('prefers topic overlap within the visible memory pool',()=>{
    expect(relevantMemories(memories,'Bob enjoys fishing by the river').map(m=>m.id)).toEqual(['river','recent']);
  });
  test('does not insert unrelated history into a new topic',()=>{
    expect(relevantMemories(memories,'Music and dancing')).toEqual([]);
  });
  test('uses input recency to break relevance ties and respects the bound',()=>{
    expect(relevantMemories(memories,'fishing',1).map(m=>m.id)).toEqual(['recent']);
  });
});
