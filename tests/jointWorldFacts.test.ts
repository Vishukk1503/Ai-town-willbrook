import { readFileSync } from 'node:fs';
import { jointWorldFacts } from '../convex/aiTown/jointWorldFacts';
import { livelihood, respondOffer, Agreement } from '../convex/aiTown/livelihoodState';
import type { Economy } from '../convex/aiTown/economyState';

const saved = JSON.parse(readFileSync('tests/fixtures/bobLuckyContext.json', 'utf8'));
function replayDecline() {
  const life = livelihood(saved.openAgreement.participants, saved.openAgreement.created);
  life.offers = [structuredClone(saved.openAgreement)];
  const economy: Economy = {
    merchant: 'p:4',
    fisher: saved.luckyId,
    market: { x: 0, y: 0 },
    bank: { x: 0, y: 0 },
    water: { x: 0, y: 0 },
    bags: [
      { owner: saved.luckyId, items: { ...saved.luckyInventory } },
      { owner: saved.bobId, items: { ...saved.bobInventory } },
    ],
    marketStock: { turnips: 0, fish: 0, seeds: 0, rod: 0, meals: 0 },
    population: 0,
    lastRecovery: 0,
    rng: 0,
    jobs: [],
    nextFish: 0,
    nextEvent: 49,
    events: structuredClone([...saved.luckyOldEvents, ...saved.bobOldEvents]),
  };
  expect(
    respondOffer(life, economy, saved.openAgreement.id, saved.luckyId, 'decline', saved.declineAt),
  ).toBe(true);
  expect(life.offers[0]).toEqual(saved.finalAgreement);
  return { livelihood: life, economy };
}

test('saved Lucky inventory stays zero despite three historical catches', () => {
  const world = replayDecline();
  expect(
    saved.luckyOldEvents.filter(
      (e: { text: string }) => e.text === 'Lucky caught a river fish and put it in his bag.',
    ),
  ).toHaveLength(3);
  const facts = jointWorldFacts(world, saved.luckyId);
  expect(facts.inventory).toEqual(saved.luckyInventory);
  expect(facts.inventory?.fish).toBe(0);
  expect(facts.factAuthority).toContain('not current stock');
  expect(world.economy.bags[0].items).toEqual(saved.luckyInventory);
});

test('saved decline survives merging both event sources and taking the latest six', () => {
  const world = replayDecline();
  for (const owner of [saved.luckyId, saved.bobId]) {
    // Reproduce the old bug using the same replayed source arrays.
    const old = [...world.livelihood.events, ...world.economy.events]
      .filter((e) => e.witnesses.includes(owner))
      .slice(-6);
    expect(old.some((e) => e.kind === 'declined')).toBe(false);
    const facts = jointWorldFacts(world, owner);
    expect(facts.recentVerifiedEvents).toHaveLength(6);
    expect(facts.recentVerifiedEvents.at(-1)).toMatchObject({
      kind: 'declined',
      at: saved.declineAt,
      source: 'livelihood',
    });
    const times = facts.recentVerifiedEvents.map((e) => e.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  }
});

test('Bob sees agreement 61 explicitly declined rather than the saved empty list', () => {
  expect(saved.bobOldAgreements).toEqual([]);
  const facts = jointWorldFacts(replayDecline(), saved.bobId);
  expect(facts.agreements).toEqual([saved.finalAgreement]);
  expect(facts.inventory).toEqual(saved.bobInventory);
});

test('retains active and terminal outcomes without leaking unrelated agreements or events', () => {
  const world = replayDecline();
  const statuses: Agreement['status'][] = [
    'open',
    'accepted',
    'cooking',
    'completed',
    'declined',
    'countered',
    'expired',
  ];
  world.livelihood.offers = statuses.map((status, id) => ({
    ...structuredClone(saved.finalAgreement),
    id,
    status,
  }));
  world.livelihood.offers.push({
    ...structuredClone(saved.finalAgreement),
    id: 99,
    participants: ['p:4'],
  });
  world.livelihood.events.push({
    id: 99,
    at: saved.declineAt + 1,
    kind: 'eat',
    text: 'Private event',
    witnesses: ['p:4'],
  });
  const facts = jointWorldFacts(world, saved.luckyId);
  expect(facts.agreements.map((o) => o.status)).toEqual(statuses);
  expect(facts.recentVerifiedEvents.some((e) => e.text === 'Private event')).toBe(false);
});

test('unknown inventory remains unknown; context selection does not mutate world state', () => {
  const world = replayDecline(),
    before = structuredClone(world);
  const facts = jointWorldFacts(world, saved.luckyId);
  facts.inventory!.fish = 9;
  facts.agreements[0].status = 'completed';
  expect(world).toEqual(before);
  expect(jointWorldFacts(world, 'missing').inventory).toBeNull();
});
