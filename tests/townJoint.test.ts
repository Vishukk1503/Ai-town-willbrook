import { jointResponseSchema, decodeJointResponse } from '../convex/aiTown/jointResponse';
import { BobLuckyFlow } from '../convex/prototypes/bobLuckyFlow';
import { jointContext } from '../convex/aiTown/jointConversation';
import { Agent } from '../convex/aiTown/agent';
import { tickSpokenPlan } from '../convex/aiTown/spokenPlan';
import {
  PlanStep,
  validateSteps,
  townOptions,
  activeBoundaries,
  stepJsonSchema,
} from '../convex/aiTown/planActions';
import { resumeState } from '../convex/aiTown/resumeState';
import { WORLD_MINUTE_MS } from '../data/worldTime';
const wait = (minutes: number): PlanStep => ({
  action: 'wait',
  target: null,
  durationMinutes: minutes,
  alone: true,
});
const walk: PlanStep = { action: 'walk', target: 'home-1', durationMinutes: null, alone: false };
function turn(f: BobLuckyFlow, name: 'Bob' | 'Lucky', action: string, steps: PlanStep[] = []) {
  const a = f.agent(name),
    c = f.game.world.conversations.get(f.conversationId!)!,
    op = 'op-' + c.numMessages;
  a.inProgressOperation = { operationId: op, name: 'agentGenerateMessage', started: f.now };
  const args = {
    agentId: a.id,
    conversationId: c.id,
    operationId: op,
    messageUuid: op,
    expectedMessages: c.numMessages,
    action,
    steps,
    invitation: null,
    speech: 'Chosen words.',
    reason: 'Test choice',
  };
  f.game.handleInput(f.now, 'finishJointTurn', args);
  return args;
}
function advance(f: BobLuckyFlow, limit = 40000) {
  const start = f.now,
    clock = f.game.world.clock!.elapsedMs,
    l = f.game.world.livelihood!,
    lc = l.clock,
    g = f.game.world.garden!,
    gc = g.time;
  for (let elapsed = 0; elapsed <= limit; elapsed += 100) {
    f.now = start + elapsed;
    f.game.world.clock!.elapsedMs = clock + elapsed;
    l.clock = lc + elapsed;
    g.time = gc + elapsed;
    f.game.numPathfinds = 0;
    for (const a of f.game.world.agents.values()) tickSpokenPlan(f.game, a, f.now);
    for (const p of f.game.world.players.values()) {
      p.tickPathfinding(f.game, f.now);
      p.tickPosition(f.game, f.now);
    }
    if (
      f.agent('Lucky').spokenPlan &&
      ['done', 'interrupted'].includes(f.agent('Lucky').spokenPlan!.state)
    )
      break;
  }
}
test.each([
  [7, true],
  [23, false],
] as const)('chosen %i-minute wait and order survive saved state', (minutes, waitFirst) => {
  const f = new BobLuckyFlow();
  turn(f, 'Bob', 'chat');
  turn(f, 'Lucky', 'plan', waitFirst ? [wait(minutes), walk] : [walk, wait(minutes)]);
  expect(
    jointContext(f.game, f.agent('Bob').id, f.conversationId!, f.now)!.knownPlan!.steps,
  ).toHaveLength(2);
  turn(f, 'Bob', 'end');
  const saved = resumeState(f.game.world.serialize());
  for (const a of saved.agents) f.game.world.agents.set(a.id as any, new Agent(a));
  advance(f);
  const s = f.agent('Lucky').spokenPlan!,
    started = s.events.find((e) => e.kind === 'wait_started')!,
    ended = s.events.find((e) => e.kind === 'wait_completed')!,
    moved = s.events.find((e) => e.kind === 'movement_started')!;
  expect(s.state).toBe('done');
  expect(ended.clock - started.clock).toBe(minutes * WORLD_MINUTE_MS);
  expect(moved.at > ended.at).toBe(waitFirst);
  expect(f.player('Lucky').position).toEqual({ x: 10, y: 6 });
  expect(f.game.takeDiff().jointMessages).toHaveLength(3);
});
test('eat consumes real inventory and reduces real hunger', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    n = f.game.world.livelihood!.needs.find((n) => n.owner === a.playerId)!,
    bag = f.game.world.economy!.bags.find((b) => b.owner === a.playerId)!.items;
  n.hunger = 60;
  const before = bag.meals!;
  turn(f, 'Lucky', 'plan', [
    { action: 'eat', target: 'eat:meals', durationMinutes: null, alone: false },
  ]);
  turn(f, 'Bob', 'end');
  advance(f);
  expect(a.spokenPlan!.state).toBe('done');
  expect(bag.meals).toBe(before - 1);
  expect(n.hunger).toBeLessThan(60);
  expect(a.spokenPlan!.events.some((e) => e.kind === 'task_completed')).toBe(true);
});
test('a work timeout does not grant output or execute its next step', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    bag = f.game.world.economy!.bags.find((b) => b.owner === a.playerId)!.items;
  bag.rod = 1;
  const before = bag.fish;
  turn(f, 'Lucky', 'plan', [
    { action: 'work', target: 'fish', durationMinutes: 1, alone: false },
    walk,
  ]);
  turn(f, 'Bob', 'end');
  advance(f);
  expect(a.spokenPlan!.state).toBe('interrupted');
  expect(bag.fish).toBe(before);
  expect(a.spokenPlan!.index).toBe(0);
  expect(f.game.world.economy!.jobs).toHaveLength(0);
});
test('existing fishing executor completes a chosen job and advances', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky');
  f.game.world.economy!.bags.find((b) => b.owner === a.playerId)!.items.rod = 1;
  turn(f, 'Lucky', 'plan', [
    { action: 'work', target: 'fish', durationMinutes: 19, alone: false },
    wait(2),
  ]);
  turn(f, 'Bob', 'end');
  advance(f);
  expect(a.spokenPlan!.state).toBe('done');
  expect(f.game.world.economy!.events.some((e) => e.kind === 'fish')).toBe(true);
});
test.each([-1, 0, 241, 1.5])(
  'rejects invalid duration %s but keeps speech',
  (minutes) => {
    const f = new BobLuckyFlow();
    turn(f, 'Lucky', 'plan', [wait(minutes)]);
    expect(f.game.jointMessages[0]?.text).toBe('Chosen words.');
    expect(f.game.world.conversations.has(f.conversationId!)).toBe(true);
    expect(f.agent('Lucky').spokenPlan).toBeUndefined();
  },
);
test('rejects inaccessible places and repeated meals that become unavailable', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky');
  expect(() => validateSteps(f.game, a, [{ ...walk, target: 'home-0' }], f.now)).toThrow('private');
  f.game.world.livelihood!.needs.find((n) => n.owner === a.playerId)!.hunger = 50;
  const eat: PlanStep = { action: 'eat', target: 'eat:meals', durationMinutes: null, alone: false };
  expect(() => validateSteps(f.game, a, [eat, eat], f.now)).toThrow('unavailable');
});
test('stale and duplicate responses cannot publish or replace a plan', () => {
  const f = new BobLuckyFlow(),
    args = turn(f, 'Bob', 'chat');
  f.game.handleInput(f.now, 'finishJointTurn', args);
  expect(f.game.jointMessages).toHaveLength(1);
  const a = f.agent('Lucky');
  a.inProgressOperation = { name: 'agentGenerateMessage', operationId: 'late', started: f.now };
  f.game.handleInput(f.now, 'finishJointTurn', {
    ...args,
    agentId: a.id,
    operationId: 'late',
    action: 'plan',
    steps: [wait(5)],
    expectedMessages: 0,
  });
  expect(f.game.jointMessages).toHaveLength(1);
  expect(a.spokenPlan).toBeUndefined();
});
test('urgent needs interrupt a running plan with an explicit reason', () => {
  const f = new BobLuckyFlow();
  turn(f, 'Lucky', 'plan', [wait(17)]);
  turn(f, 'Bob', 'end');
  const a = f.agent('Lucky');
  tickSpokenPlan(f.game, a, f.now);
  f.game.world.livelihood!.needs.find((n) => n.owner === a.playerId)!.hunger = 95;
  expect(tickSpokenPlan(f.game, a, f.now + 100)).toBe(false);
  expect(a.spokenPlan!.reason).toContain('food');
});
test('Stella stays outside this route', () => {
  const f = new BobLuckyFlow();
  f.game.playerDescriptions.get(f.player('Lucky').id)!.name = 'Stella';
  expect(jointContext(f.game, f.agent('Bob').id, f.conversationId!, f.now)).toBeNull();
});

test('dialogue exposes the same currently permitted town actions', () => {
  const f = new BobLuckyFlow();
  for (const name of ['Bob', 'Lucky'] as const) {
    const a = f.agent(name),
      x = jointContext(f.game, a.id, f.conversationId!, f.now)!;
    for (const o of townOptions(f.game, a, f.now))
      expect(x.options.some((x) => x.id === o.id)).toBe(true);
  }
  expect(stepJsonSchema.properties).not.toHaveProperty('alone');
});
test('expired boundaries are not supplied as current state; waiting creates none', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    clock = f.game.world.clock!.elapsedMs;
  a.awareness!.boundaries = [
    {
      speaker: f.agent('Bob').playerId,
      recipient: a.playerId,
      scope: 'contact',
      activity: 'any',
      expiresAt: clock - 1,
      sourceText: 'expired',
    },
  ];
  expect(activeBoundaries(f.game, a)).toEqual([]);
  turn(f, 'Lucky', 'plan', [{ action: 'wait', target: null, durationMinutes: 3 }]);
  turn(f, 'Bob', 'end');
  advance(f);
  expect(f.agent('Bob').awareness?.boundaries ?? []).toEqual([]);
});
test('a gift is proposed from dialogue and accepted explicitly, not transferred by words', () => {
  const f = new BobLuckyFlow(),
    e = f.game.world.economy!,
    l = f.game.world.livelihood!,
    bob = f.agent('Bob'),
    lucky = f.agent('Lucky');
  e.bags.find((b) => b.owner === bob.playerId)!.items.turnips = 5;
  const id = 'gift:' + lucky.playerId + ':turnips';
  expect(townOptions(f.game, bob, f.now).some((o) => o.id === id)).toBe(true);
  turn(f, 'Bob', id);
  expect(l.offers).toHaveLength(1);
  expect(e.bags.find((b) => b.owner === lucky.playerId)!.items.turnips).toBe(0);
  const accept = 'accept:' + l.offers[0].id;
  expect(
    jointContext(f.game, lucky.id, f.conversationId!, f.now)!.options.some((o) => o.id === accept),
  ).toBe(true);
  turn(f, 'Lucky', accept);
  expect(l.offers[0].status).toBe('accepted');
  expect(f.game.world.conversations.size).toBe(0);
  expect(f.game.jointMessages).toHaveLength(2);
});
test('a barter counter uses the same agreement executor', () => {
  const f = new BobLuckyFlow(),
    e = f.game.world.economy!,
    l = f.game.world.livelihood!,
    bob = f.agent('Bob'),
    lucky = f.agent('Lucky');
  e.bags.find((b) => b.owner === bob.playerId)!.items.turnips = 5;
  e.bags.find((b) => b.owner === lucky.playerId)!.items.fish = 3;
  const offer = townOptions(f.game, bob, f.now).find((o) => o.proposal?.kind === 'barter')!;
  turn(f, 'Bob', offer.id);
  turn(f, 'Lucky', 'counter:' + l.offers[0].id);
  expect(l.offers[0].status).toBe('countered');
  expect(l.offers[1].proposer).toBe(lucky.playerId);
  expect(f.game.jointMessages).toHaveLength(2);
});

test('a proposal followed by waiting advances without assuming the gift was accepted', () => {
  const f = new BobLuckyFlow(),
    bob = f.agent('Bob'),
    lucky = f.agent('Lucky'),
    e = f.game.world.economy!,
    l = f.game.world.livelihood!;
  e.bags.find((b) => b.owner === bob.playerId)!.items.turnips = 5;
  turn(f, 'Bob', 'plan', [
    { action: 'town', target: 'gift:' + lucky.playerId + ':turnips', durationMinutes: null },
    { action: 'wait', target: null, durationMinutes: 2 },
  ]);
  turn(f, 'Lucky', 'end');
  tickSpokenPlan(f.game, bob, f.now);
  expect(l.offers[0].status).toBe('open');
  expect(bob.spokenPlan?.index).toBe(1);
  tickSpokenPlan(f.game, bob, f.now + 100);
  expect(bob.spokenPlan?.state).toBe('waiting');
  expect(e.bags.find((b) => b.owner === lucky.playerId)!.items.turnips).toBe(0);
});
test('direct full-menu fishing executes through the normal engine without another choice call', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky');
  f.game.world.economy!.bags.find((b) => b.owner === a.playerId)!.items.rod = 1;
  turn(f, 'Lucky', 'fish');
  turn(f, 'Bob', 'end');
  const start = f.now;
  for (let t = 0; t < 60000; t += 100) {
    f.now = start + t;
    f.game.numPathfinds = 0;
    f.game.tick(f.now);
    f.game.pendingOperations = [];
    if (a.spokenPlan?.state === 'done') break;
  }
  expect(a.spokenPlan?.state).toBe('done');
  expect(f.game.world.economy!.events.some((e) => e.kind === 'fish')).toBe(true);
});
test('sleep and seed deposit can be committed from the shared menu', () => {
  for (const kind of ['sleep', 'deposit']) {
    const f = new BobLuckyFlow(),
      a = f.agent('Bob');
    if (kind === 'sleep')
      f.game.world.livelihood!.needs.find((n) => n.owner === a.playerId)!.restedness = 20;
    else f.game.world.economy!.bags.find((b) => b.owner === a.playerId)!.items.seeds = 2;
    expect(
      jointContext(f.game, a.id, f.conversationId!, f.now)!.options.some((o) => o.id === kind),
    ).toBe(true);
    turn(f, 'Bob', kind);
    turn(f, 'Lucky', 'end');
    tickSpokenPlan(f.game, a, f.now);
    if (kind === 'sleep') expect(a.sleep?.phase).toBe('going_home');
    else
      expect(
        f.game.world.economy!.jobs.some((j) => j.owner === a.playerId && j.kind === 'deposit'),
      ).toBe(true);
  }
});

test('one action list represents the captured eat choice and executes it', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Bob'),
    n = f.game.world.livelihood!.needs.find((n) => n.owner === a.playerId)!,
    bag = f.game.world.economy!.bags.find((b) => b.owner === a.playerId)!.items;
  n.hunger = 18.5;
  bag.turnips = 8;
  const x = jointContext(f.game, a.id, f.conversationId!, f.now)!;
  const decoded = decodeJointResponse(
    {
      decisions: [{ action: 'eat:turnips', durationMinutes: null, words: 'Turnip will do.' }],
      reason: 'Need to satisfy hunger quickly.',
    },
    x.options.map((o) => o.id),
    x.town,
  );
  const args = turn(f, 'Bob', decoded.action, decoded.steps);
  turn(f, 'Lucky', 'end');
  const start = f.now;
  for (let t = 0; t < 5000; t += 100) {
    f.now = start + t;
    f.game.tick(f.now);
    f.game.pendingOperations = [];
  }
  expect(bag.turnips).toBe(7);
  expect(n.hunger).toBeLessThan(2);
  expect(a.spokenPlan?.state).toBe('done');
  expect(jointResponseSchema(['eat:turnips']).properties).not.toHaveProperty('action');
  expect(() =>
    decodeJointResponse(
      { ...decoded, steps: [{ action: 'eat:turnips', durationMinutes: null }] },
      x.options.map((o) => o.id),
      x.town,
    ),
  ).toThrow('Invalid joint response');
});

test('decision-bound words stay model-written and free-standing speech is rejected', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    x = jointContext(f.game, a.id, f.conversationId!, f.now)!;
  const result = decodeJointResponse(
    {
      decisions: [
        { action: 'walk:river', durationMinutes: null, words: 'I fancy a walk to the water.' },
        { action: 'wait', durationMinutes: 3, words: 'A few quiet minutes there would suit me.' },
      ],
      reason: 'Chosen outing',
    },
    x.options.map((o) => o.id),
    x.town,
  );
  expect(result.speech).toBe(
    'I fancy a walk to the water. A few quiet minutes there would suit me.',
  );
  expect(result.decisionWords.map((d) => d.action)).toEqual(['walk:river', 'wait']);
  expect(jointResponseSchema(['walk:river']).properties).not.toHaveProperty('speech');
  expect(() =>
    decodeJointResponse(
      { decisions: result.decisionWords, reason: 'Outing', speech: 'Extra promise' },
      x.options.map((o) => o.id),
      x.town,
    ),
  ).toThrow('Invalid joint response');
});

test('mismatched action metadata does not suppress spoken words', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    x = jointContext(f.game, a.id, f.conversationId!, f.now)!;
  const decoded = decodeJointResponse(
    {
      decisions: [{ action: 'end', durationMinutes: null, words: 'Farewell, Bob.' }],
      reason: 'Leave',
    },
    x.options.map((o) => o.id),
    x.town,
  );
  a.inProgressOperation = {
    name: 'agentGenerateMessage',
    operationId: 'bound-words',
    started: f.now,
  };
  f.game.handleInput(f.now, 'finishJointTurn', {
    ...decoded,
    action: 'chat',
    agentId: a.id,
    conversationId: f.conversationId!,
    operationId: 'bound-words',
    messageUuid: 'bound-words',
    expectedMessages: 0,
    invitation: null,
  });
  expect(f.game.jointMessages[0]?.text).toBe('Farewell, Bob.');
  expect(f.game.world.conversations.has(f.conversationId!)).toBe(true);
  expect(a.spokenPlan).toBeUndefined();
});

test('place and food effects distinguish visiting, collecting and eating', () => {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    x = jointContext(f.game, a.id, f.conversationId!, f.now)!;
  expect(x.options.find((o) => o.id === 'place:home-1')!.effect).toContain('No food');
  expect(x.options.find((o) => o.id === 'place:home-1')!.effect).toContain('shared invitation');
  expect(x.options.find((o) => o.id === 'forage')!.effect).toContain('Does not eat');
});
