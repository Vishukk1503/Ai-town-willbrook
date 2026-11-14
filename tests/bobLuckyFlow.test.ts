import { BobLuckyFlow } from '../convex/prototypes/bobLuckyFlow';
import { Conversation } from '../convex/aiTown/conversation';
import { blocksContact } from '../convex/aiTown/socialBoundary';
import { WORLD_HOUR_MS } from '../data/worldTime';
const offer = (f: BobLuckyFlow) =>
  f.commit(f.prepare('Bob', 'invite_walk'), 'Fancy a walk to the river?');
const decline = (f: BobLuckyFlow) =>
  f.commit(
    f.prepare('Lucky', 'home_then_quiet_hour'),
    'I am heading home, then taking an hour alone.',
  );

test('full refusal flow executes real invitation, boundary, conversation closure and both routes', () => {
  const f = new BobLuckyFlow(),
    inventory = JSON.stringify(f.snapshot().inventory);
  offer(f);
  expect(f.snapshot().invitation?.status).toBe('proposed');
  expect(f.paths).toHaveLength(0);
  decline(f);
  expect(f.snapshot().invitation?.status).toBe('declined');
  expect(f.snapshot().conversationOpen).toBe(true);
  expect(f.menu()).toEqual(['ack_garden', 'ack_home']);
  expect(f.snapshot().bobBoundaries[0].expiresAt).toBe(3 * WORLD_HOUR_MS);
  f.commit(f.prepare('Bob', 'ack_garden'), 'All right. I will head to the garden.');
  expect(f.snapshot().conversationOpen).toBe(false);
  expect(f.transcript).toHaveLength(3);
  expect(Conversation.start(f.game, f.now, f.player('Bob'), f.player('Lucky')).error).toContain(
    'boundary',
  );
  const paths = f.executeMovement();
  expect(paths).toHaveLength(2);
  expect(paths.every((p) => p.arrived && p.positions.length > 2 && p.elapsedMs > 0)).toBe(true);
  expect(f.snapshot().positions).toEqual({ Bob: { x: 7, y: 7 }, Lucky: { x: 10, y: 6 } });
  expect(JSON.stringify(f.snapshot().inventory)).toBe(inventory);
  expect(f.player('Bob').pathfinding).toBeUndefined();
  expect(f.player('Lucky').pathfinding).toBeUndefined();
  expect(blocksContact(f.snapshot().bobBoundaries, 'p:0', 16 * WORLD_HOUR_MS)).toBe(false);
});
test('duplicate ticket cannot publish or act twice', () => {
  const f = new BobLuckyFlow(),
    t = f.prepare('Bob', 'invite_walk');
  f.commit(t, 'Walk with me?');
  const before = JSON.stringify(f.snapshot());
  expect(() => f.commit(t, 'Again?')).toThrow('Stale');
  expect(JSON.stringify(f.snapshot())).toBe(before);
});
test('emergency arriving during generation prevents speech and effect commit', () => {
  const f = new BobLuckyFlow(),
    t = f.prepare('Bob', 'invite_walk');
  f.game.world.livelihood!.needs[0].hunger = 95;
  expect(() => f.commit(t, 'Walk with me?')).toThrow('emergency');
  expect(f.transcript).toHaveLength(0);
  expect(f.snapshot().invitation).toBeNull();
});
test('expired offer cannot be answered or published', () => {
  const f = new BobLuckyFlow();
  offer(f);
  const t = f.prepare('Lucky', 'quiet_hour_then_home');
  f.game.world.livelihood!.clock = f.snapshot().invitation!.expires;
  expect(() => f.commit(t, 'Not now.')).toThrow('expired');
  expect(f.transcript).toHaveLength(1);
  expect(f.phase).toBe('offered');
});
test('invalid speaker, choice and empty speech have no effects', () => {
  const f = new BobLuckyFlow();
  expect(() => f.prepare('Lucky', 'invite_walk')).toThrow();
  expect(() => f.prepare('Bob', 'ack_home')).toThrow();
  expect(() => f.commit(f.prepare('Bob', 'invite_walk'), ' ')).toThrow('Invalid speech');
  expect(f.revision).toBe(0);
  expect(f.snapshot().invitation).toBeNull();
});
test('changed destination prevents publishing the corresponding movement claim', () => {
  const f = new BobLuckyFlow();
  offer(f);
  decline(f);
  const t = f.prepare('Bob', 'ack_garden');
  f.player('Lucky').position = { x: 7, y: 7 };
  const before = JSON.stringify(f.snapshot());
  expect(() => f.commit(t, 'I will head to the garden.')).toThrow('reachable');
  expect(JSON.stringify(f.snapshot())).toBe(before);
});
test('choice to leave without inviting is also executed, not rewritten into the desired scenario', () => {
  const f = new BobLuckyFlow();
  f.commit(f.prepare('Bob', 'leave_for_garden'), 'I will head to the garden.');
  expect(f.snapshot().invitation).toBeNull();
  expect(f.executeMovement()).toHaveLength(1);
  expect(f.paths[0].arrived).toBe(true);
  expect(f.snapshot().positions.Lucky).toEqual({ x: 5, y: 4 });
});
test('shorter boundary uses village time and permits contact after expiry', () => {
  const f = new BobLuckyFlow();
  offer(f);
  f.commit(f.prepare('Lucky', 'quiet_hour_then_home'), 'An hour here alone, please. Then I will head home.');
  expect(f.snapshot().bobBoundaries[0].expiresAt).toBe(3 * WORLD_HOUR_MS);
  f.commit(f.prepare('Bob', 'ack_home'), 'Understood. I am heading home too.');
  f.executeMovement();
  f.game.world.clock!.elapsedMs = 3 * WORLD_HOUR_MS;
  expect(
    Conversation.start(f.game, f.now, f.player('Bob'), f.player('Lucky')).error,
  ).toBeUndefined();
});

 test.each(['home_then_quiet_hour','quiet_hour_then_home'] as const)('sequence %s honors a full stationary hour and the selected order',choice=>{
  const f=new BobLuckyFlow();offer(f);f.commit(f.prepare('Lucky',choice),'One hour alone.');
  f.commit(f.prepare('Bob','ack_garden'),'I will head to the garden.');const start=f.now;
  f.executeMovement();
  const waitStart=f.events.find(e=>e.kind==='wait_started')!,waitEnd=f.events.find(e=>e.kind==='wait_completed')!;
  const path=f.paths.find(p=>p.actor==='Lucky')!;
  expect(waitEnd.at-waitStart.at).toBe(WORLD_HOUR_MS);
  expect(f.luckySequence!.waitSamples.length).toBeGreaterThan(500);
  const pos=choice==='home_then_quiet_hour'?{x:10,y:6}:{x:5,y:4};
  expect(f.luckySequence!.waitSamples.every(s=>s.position.x===pos.x&&s.position.y===pos.y)).toBe(true);
  expect(path.startedAt).toBe(choice==='home_then_quiet_hour'?start:start+WORLD_HOUR_MS);
  expect(path.firstMovedAt).toBeGreaterThanOrEqual(path.startedAt);
  expect(f.luckySequence!.state).toBe('done');
  expect(f.snapshot().bobBoundaries[0].expiresAt).toBe(2*WORLD_HOUR_MS+waitEnd.at-start);
 });
