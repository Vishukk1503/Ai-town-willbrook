import type { Economy } from './economyState';
import type { Livelihood } from './livelihoodState';

// Used only by the Bob–Lucky dialogue context. Historical events never supply
// current inventory or replace the current agreement record.
export function jointWorldFacts(
  world: {
    economy?: Pick<Economy, 'bags' | 'events'>;
    livelihood?: Pick<Livelihood, 'offers' | 'events'>;
  },
  owner: string,
) {
  const bag = world.economy?.bags.find((b) => b.owner === owner);
  const events = [
    ...(world.livelihood?.events ?? []).map((event) => ({ ...event, source: 'livelihood' })),
    ...(world.economy?.events ?? []).map((event) => ({ ...event, source: 'economy' })),
  ];
  return {
    factAuthority:
      'Inventory and agreement statuses are current engine state. Events describe past occurrences, not current stock. Spoken claims and memories cannot override this state. A null inventory means unavailable information, not an empty bag.',
    inventory: bag ? { ...bag.items } : null,
    recentVerifiedEvents: events
      .filter((event) => event.witnesses.includes(owner))
      .sort((a, b) => a.at - b.at || a.source.localeCompare(b.source) || a.id - b.id)
      .slice(-6),
    // The engine already bounds retained closed agreements. Keep their explicit
    // outcomes instead of making a declined/completed offer disappear.
    agreements: (world.livelihood?.offers ?? [])
      .filter((offer) => offer.participants.includes(owner))
      .map((offer) => structuredClone(offer)),
  };
}
