import {
  decodePlan,
  planSchema,
  threeStage,
  reviewBasis,
  sameSteps,
} from '../convex/aiTown/jointThreeStage';
import { BobLuckyFlow } from '../convex/prototypes/bobLuckyFlow';
import { jointContext } from '../convex/aiTown/jointConversation';
const good = JSON.stringify({statements:[{quote:'My own words.',kind:'expression',actionIndexes:[],evidence:'An expression, no undertaking.',verdict:'no_action_needed'}]});
function fixture(verdict = good) {
  const calls: string[] = [],
    published: any[] = [];
  return {
    calls,
    published,
    flow: {
      maxRepairs: 0,
      choose: async () => {
        calls.push('choose');
        return 'draft';
      },
      validate: async (raw: string) => {
        calls.push('validate');
        return { action: 'chat', selected: [{action:'chat'}] };
      },
      speak: async () => {
        calls.push('speak');
        return JSON.stringify({ speech: 'My own words.' });
      },
      review: async () => {
        calls.push('review');
        return verdict;
      },
      commit: async (plan: any, speech: string) => {
        calls.push('commit');
        published.push({ plan, speech });
      },
    },
  };
}
test('three stages commit original words only after review', async () => {
  const t = fixture();
  await threeStage(t.flow);
  expect(t.calls).toEqual(['choose', 'validate', 'speak', 'review', 'commit']);
  expect(t.published[0].speech).toBe('My own words.');
});
test('negative semantic verdict withholds both speech and actions without retry', async () => {
  const t = fixture(
    JSON.stringify({
      statements:[{quote:'My own words.',kind:'commitment',actionIndexes:[],evidence:'Unselected action',verdict:'unsupported'}],
    }),
  );
  await expect(threeStage(t.flow)).rejects.toThrow('Review rejected');
  expect(t.published).toEqual([]);
  expect(t.calls.filter((c) => c === 'review')).toHaveLength(1);
});
test('malformed or contradictory reviewer approval cannot publish', async () => {
  for (const verdict of [
    'oops',
    JSON.stringify({
      approved: true,
      issues: [{ quote: 'x', reason: 'mismatch' }],
      explanation: 'bad',
    }),
  ]) {
    const t = fixture(verdict);
    await expect(threeStage(t.flow)).rejects.toThrow();
    expect(t.published).toHaveLength(0);
  }
});
test('invalid plan prevents spending on speech and review', async () => {
  const t = fixture();
  t.flow.validate = async () => {
    throw Error('invalid sequence');
  };
  await expect(threeStage(t.flow)).rejects.toThrow('invalid sequence');
  expect(t.calls).toEqual(['choose']);
});
test('conversation actions cannot be embedded in physical sequences', () => {
  const f = new BobLuckyFlow(),
    x = jointContext(f.game, f.agent('Bob').id, f.conversationId!, f.now)!;
  expect(() =>
    decodePlan(
      JSON.stringify({
        choice: {
          kind: 'actions',
          steps: [
            { action: 'wander', durationMinutes: null },
            { action: 'chat', durationMinutes: null },
          ],
        },
        reason: 'x',
      }),
      x.options.map((o) => o.id),
      x.town,
    ),
  ).toThrow('combination');
  const schema = planSchema(x.options.map((o) => o.id));
  expect(JSON.stringify(schema.properties.choice.anyOf[1])).not.toContain('"chat"');
});
test('world change rejects actions without blocking speech', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    basis = reviewBasis(f.game, a);
  a.inProgressOperation = {
    name: 'agentGenerateMessage',
    operationId: 'review-test',
    started: f.now,
  };
  f.game.world.economy!.bags[0].items.turnips++;
  f.game.handleInput(f.now, 'finishJointTurn', {
    agentId: a.id,
    conversationId: f.conversationId!,
    operationId: 'review-test',
    messageUuid: 'review-test',
    expectedMessages: 0,
    action: 'chat',
    steps: [],
    invitation: null,
    speech: 'Hello Bob.',
    reason: 'Chat',
    reviewBasis: basis,
  });
  expect(f.game.jointMessages[0]?.text).toBe('Hello Bob.');
  expect(f.game.world.conversations.has(f.conversationId!)).toBe(true);
});

test('approval compares action values across Convex field reordering', () => {
  const original = [{ action: 'work', target: 'forage', durationMinutes: 15 }];
  const transported = [{ action: 'work', durationMinutes: 15, target: 'forage' }];
  expect(JSON.stringify(original)).not.toBe(JSON.stringify(transported));
  expect(sameSteps(original, transported)).toBe(true);
  expect(sameSteps(original, [{ ...transported[0], durationMinutes: 16 }])).toBe(false);
});

test('comparison must account for every clause, not only the harmless greeting', async () => {
  const t = fixture(JSON.stringify({statements:[{quote:'My own',kind:'expression',actionIndexes:[],evidence:'Greeting',verdict:'no_action_needed'}]}));
  await expect(threeStage(t.flow)).rejects.toThrow('omitted');
  expect(t.published).toHaveLength(0);
});
test('a classified commitment without a plan reference fails even if model calls it supported', async () => {
  const t = fixture(JSON.stringify({statements:[{quote:'My own words.',kind:'commitment',actionIndexes:[],evidence:'Sounds reasonable',verdict:'supported'}]}));
  await expect(threeStage(t.flow)).rejects.toThrow('Review rejected');
  expect(t.published).toHaveLength(0);
});
test('one bounded character repair is checked again before publishing original revised words', async () => {
  const t = fixture(); t.flow.maxRepairs = 1;
  let n=0;
  t.flow.review = async () => ++n === 1 ? JSON.stringify({statements:[{quote:'My own words.',kind:'commitment',actionIndexes:[],evidence:'Missing action',verdict:'unsupported'}]}) : good;
  await threeStage(t.flow);
  expect(n).toBe(2); expect(t.published).toHaveLength(1);
});
test('repeated mismatch is withheld after exactly two attempts', async () => {
  const t = fixture(JSON.stringify({statements:[{quote:'My own words.',kind:'commitment',actionIndexes:[],evidence:'Missing action',verdict:'unsupported'}]})); t.flow.maxRepairs=1;
  await expect(threeStage(t.flow)).rejects.toThrow('Review rejected');
  expect(t.calls.filter(c=>c==='review')).toHaveLength(2); expect(t.published).toHaveLength(0);
});
test('speaker proposed plan is validated before comparison and retained at commit', async () => {
  const t=fixture(); const validated:string[]=[];
  t.flow.validate=async raw=>{validated.push(raw); return {action:raw,selected:[{action:raw}]};};
  t.flow.speak=async()=>JSON.stringify({speech:'My own words.',proposedPlan:{choice:{kind:'conversation',action:'end'},reason:'Changed my mind'}});
  await threeStage(t.flow);
  expect(validated).toHaveLength(2); expect(t.published[0].plan.action).toBe(validated[1]);
});


test('live flow publishes original dialogue without requesting semantic review', async () => {
  const t = fixture();
  const {review, ...flow} = t.flow;
  await threeStage(flow);
  expect(t.calls).toEqual(['choose', 'validate', 'speak', 'commit']);
  expect(t.published[0].speech).toBe('My own words.');
});

test('removing semantic review does not bypass engine plan validation', async () => {
  const t = fixture();
  const {review, ...flow} = t.flow;
  flow.validate = async () => {throw Error('Missing required inventory');};
  await expect(threeStage(flow)).rejects.toThrow('Missing required inventory');
  expect(t.published).toHaveLength(0);
  expect(t.calls).toEqual(['choose']);
});

test('unsupported spoken promise no longer closes chat or creates an unselected physical action', () => {
  const f = new BobLuckyFlow(), a=f.agent('Lucky');
  const x=jointContext(f.game,a.id,f.conversationId!,f.now)!;
  const operationId='unreviewed-chat';
  const speech="I will go to the river later.";
  a.inProgressOperation={name:'agentGenerateMessage',operationId,started:f.now};
  const position={...f.player('Lucky').position};
  f.game.handleInput(f.now,'finishJointTurn',{
    agentId:a.id,conversationId:f.conversationId!,operationId,messageUuid:operationId,
    expectedMessages:x.c.numMessages,action:'chat',steps:[],invitation:null,speech,
    decisionWords:[{action:'chat',durationMinutes:null,words:speech}],reason:'Talk',
    reviewBasis:reviewBasis(f.game,a),
  });
  expect(f.game.jointMessages[0]?.text).toBe(speech);
  expect(f.game.world.conversations.has(f.conversationId!)).toBe(true);
  expect(a.spokenPlan).toBeUndefined();
  expect(f.player('Lucky').position).toEqual(position);
});
