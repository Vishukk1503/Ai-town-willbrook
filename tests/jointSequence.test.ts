import { readFileSync, writeFileSync } from 'node:fs';
import { BobLuckyFlow } from '../convex/prototypes/bobLuckyFlow';
import { decodeJointResponse } from '../convex/aiTown/jointResponse';
import { jointContext } from '../convex/aiTown/jointConversation';
import { tickSpokenPlan } from '../convex/aiTown/spokenPlan';
import { economyWork } from '../convex/aiTown/economyRuntime';
import { Agent } from '../convex/aiTown/agent';

const saved = JSON.parse(readFileSync('tests/fixtures/bobLuckyDeclineFishing.json', 'utf8'));

// Offline only: real input handler, pathfinding and fishing worker on a fixture
// map. No backend client, provider, Bob reply or generated dialogue is involved.
function replay(response = saved.response) {
  const f = new BobLuckyFlow(),
    a = f.agent('Lucky'),
    p = f.player('Lucky'),
    l = f.game.world.livelihood!,
    e = f.game.world.economy!,
    g = f.game.world.garden!;
  f.game.worldMap.width = 50;
  f.game.worldMap.height = 50;
  p.position = { ...saved.position };
  f.player('Bob').position = { ...saved.bob.position };
  Object.assign(
    l.needs.find((n) => n.owner === a.playerId)!,
    saved.needs,
  );
  Object.assign(
    l.needs.find((n) => n.owner === f.agent('Bob').playerId)!,
    saved.bob.needs,
  );
  e.bags.find((b) => b.owner === a.playerId)!.items = { ...saved.inventory };
  e.bags.find((b) => b.owner === f.agent('Bob').playerId)!.items = { ...saved.bob.inventory };
  e.bank = { ...saved.bank };
  l.offers = [structuredClone(saved.agreement)];
  l.clock = saved.agreement.created + 1000;
  g.time = l.clock;
  e.lastRecovery = g.time;
  f.game.world.clock!.elapsedMs = l.clock;
  const x = jointContext(f.game, a.id, f.conversationId!, f.now)!;
  const decoded = decodeJointResponse(
    {
      decisions: response.steps.map((s: any, i: number) => ({
        ...s,
        words: i === 0 ? response.speech : '',
      })),
      reason: response.reason,
    },
    x.options.map((o) => o.id),
    x.town,
  );
  const operationId = 'saved-response-replay';
  a.inProgressOperation = { name: 'agentGenerateMessage', operationId, started: f.now };
  f.game.handleInput(f.now, 'finishJointTurn', {
    ...decoded,
    agentId: a.id,
    conversationId: f.conversationId!,
    operationId,
    expectedMessages: x.c.numMessages,
    messageUuid: operationId,
    invitation: null,
  });
  expect(f.game.jointMessages[0]?.text).toBe(saved.response.speech);
  expect(a.spokenPlan?.state).toBe('pending');
  // Release the existing acknowledgment gate without inventing a model reply.
  x.c.leave(f.game, f.now, f.player('Bob'));
  return { f, a, p, l, e, g };
}

test('saved decline then fishing executes in order, without granting invented inventory', () => {
  const { f, a, p, l, e, g } = replay(),
    start = f.now,
    clock = l.clock,
    bag = e.bags.find((b) => b.owner === a.playerId)!.items,
    samples: object[] = [];
  let firstMovedMs: number | undefined;
  for (let elapsed = 0; elapsed <= 60000; elapsed += 100) {
    f.now = start + elapsed;
    f.game.world.clock!.elapsedMs = l.clock = g.time = clock + elapsed;
    f.game.numPathfinds = 0;
    tickSpokenPlan(f.game, a, f.now);
    p.tickPathfinding(f.game, f.now);
    p.tickPosition(f.game, f.now);
    if (
      firstMovedMs === undefined &&
      Math.hypot(p.position.x - saved.position.x, p.position.y - saved.position.y) > 0.01
    )
      firstMovedMs = elapsed;
    if (elapsed === 0) {
      expect(l.offers[0].status).toBe('declined');
      expect(a.spokenPlan?.index).toBe(1);
      expect(bag.fish).toBe(0);
      expect(e.jobs).toHaveLength(0);
    }
    if (!e.events.some((ev) => ev.kind === 'fish')) expect(bag.fish).toBe(0);
    if (elapsed % 1000 === 0)
      samples.push({
        elapsedMs: elapsed,
        position: { ...p.position },
        state: a.spokenPlan?.state,
        fish: bag.fish,
      });
    if (['done', 'interrupted'].includes(a.spokenPlan!.state)) break;
  }
  expect(a.spokenPlan?.state).toBe('done');
  expect(a.spokenPlan?.index).toBe(2);
  expect(l.offers[0].status).toBe('declined');
  expect(firstMovedMs).toBeGreaterThan(0);
  expect(e.events.filter((ev) => ev.kind === 'fish')).toHaveLength(1);
  expect(e.jobs).toHaveLength(0);
  expect(f.game.pendingOperations).toHaveLength(0);
  const work = a.spokenPlan!.events.find((ev) => ev.kind === 'work_started')!;
  const completed = a.spokenPlan!.events.find((ev) => ev.kind === 'task_completed')!;
  expect(completed.at - work.at).toBe(12000);
  const report = {
    mode: 'Offline saved-response replay using town engine on open fixture map; not a live town encounter',
    acknowledgment: 'Conversation closed by harness; no Bob reply generated',
    source: saved.source,
    choices: saved.response.steps,
    speech: f.game.jointMessages[0].text,
    agreement: {
      id: saved.agreement.id,
      before: saved.agreement.status,
      after: l.offers[0].status,
    },
    beforeInventory: saved.inventory,
    afterInventory: bag,
    startPosition: saved.position,
    endPosition: p.position,
    firstMovedMs,
    fishingStartedMs: work.at - start,
    fishingCompletedMs: completed.at - start,
    fishingEvents: e.events,
    execution: a.spokenPlan,
    samples,
    newModelCalls: 0,
    newProviderCostUsd: 0,
  };
  if (process.env.SEQUENCE_REPLAY_REPORT)
    writeFileSync(process.env.SEQUENCE_REPLAY_REPORT, JSON.stringify(report, null, 2) + '\n');
});

test('rechecks the next step against changed inventory and preserves the completed decline', () => {
  const { f, a, l, e } = replay();
  tickSpokenPlan(f.game, a, f.now);
  e.bags.find((b) => b.owner === a.playerId)!.items.rod = 0;
  tickSpokenPlan(f.game, a, f.now + 100);
  expect(l.offers[0].status).toBe('declined');
  expect(a.spokenPlan?.state).toBe('interrupted');
  expect(a.spokenPlan?.index).toBe(1);
  expect(e.jobs).toHaveLength(0);
  expect(e.events).toHaveLength(0);
});

test('a delegated job advances after its completion event, including across save/load', () => {
  const { f, a, p, l, e, g } = replay({
    ...saved.response,
    steps: [
      { action: 'fish', durationMinutes: null },
      { action: 'wait', durationMinutes: 2 },
    ],
  });
  const start = f.now,
    clock = l.clock;
  tickSpokenPlan(f.game, a, f.now);
  const loaded = new Agent(a.serialize());
  f.game.world.agents.set(a.id, loaded);
  for (let elapsed = 100; elapsed <= 60000; elapsed += 100) {
    f.now = start + elapsed;
    f.game.world.clock!.elapsedMs = l.clock = g.time = clock + elapsed;
    f.game.numPathfinds = 0;
    if (!tickSpokenPlan(f.game, loaded, f.now)) economyWork(f.game, loaded.playerId, f.now);
    p.tickPathfinding(f.game, f.now);
    p.tickPosition(f.game, f.now);
    if (['done', 'interrupted'].includes(loaded.spokenPlan!.state)) break;
  }
  expect(loaded.spokenPlan?.state).toBe('done');
  const caught = e.events.find((ev) => ev.kind === 'fish')!;
  const waited = loaded.spokenPlan!.events.find((ev) => ev.kind === 'wait_started')!;
  expect(waited.at).toBeGreaterThan(caught.at);
});

test('a removed delegated job is a failure, not permission to start the next step', () => {
  const { f, a, e } = replay({
    ...saved.response,
    steps: [
      { action: 'fish', durationMinutes: null },
      { action: 'wait', durationMinutes: 2 },
    ],
  });
  tickSpokenPlan(f.game, a, f.now);
  expect(a.spokenPlan?.state).toBe('delegated');
  e.jobs = [];
  tickSpokenPlan(f.game, a, f.now + 100);
  expect(a.spokenPlan?.state).toBe('interrupted');
  expect(a.spokenPlan?.index).toBe(0);
  expect(a.spokenPlan?.events.some((ev) => ev.kind === 'wait_started')).toBe(false);
});
