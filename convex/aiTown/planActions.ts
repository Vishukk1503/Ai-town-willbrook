import { v, Infer } from 'convex/values';
import type { Game } from './game';
import type { Agent } from './agent';
import { availableActions } from './actionChoice';
import { activityPlaces } from './socialActivity';
import { findRoute } from './movement';
import { REST_MAX_MS } from './sleepState';
import { WORLD_MINUTE_MS } from '../../data/worldTime';
import { eat, RECIPES } from './livelihoodState';
import { emergencyNeed } from './physicalPriority';

// Bounds constrain resources, not preferences. There is no default duration.
export const durationBounds = {
  wait: { min: 1, max: 240 },
  rest: { min: 1, max: REST_MAX_MS / WORLD_MINUTE_MS },
  work: { min: 1, max: 120 },
};
export const planStep = v.object({
  action: v.union(
    v.literal('walk'),
    v.literal('wait'),
    v.literal('rest'),
    v.literal('eat'),
    v.literal('work'),
    v.literal('town'),
  ),
  target: v.union(v.string(), v.null()),
  durationMinutes: v.union(v.number(), v.null()),
  alone: v.optional(v.boolean()),
});
export type PlanStep = Infer<typeof planStep>;
export const walkInvitation = v.object({
  from: v.string(),
  to: v.string(),
  delayMinutes: v.number(),
});
export const stepJsonSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['walk', 'wait', 'rest', 'eat', 'work', 'town'] },
    target: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    durationMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  },
  required: ['action', 'target', 'durationMinutes'],
  additionalProperties: false,
};
// Same availableActions source as daily decisions. Only the actor's current
// encounter is removed for post-conversation planning; other encounters remain.
export function townOptions(game: Game, a: Agent, now: number, world = game.world.serialize()) {
  const current = world.conversations.find((c) =>
    c.participants.some((p) => p.playerId === a.playerId),
  );
  const partners = current?.participants.map((p) => p.playerId) ?? [];
  return availableActions(
    {
      ...world,
      conversations: world.conversations.filter((c) => c !== current),
      awareness: a.awareness,
      lastWakeClock: a.lastWakeClock,
      currentDecision: a.decision,
    },
    a.playerId,
    now,
    a.lastInviteAttempt,
    a.lastConversation,
    game.playerDescriptions.get(a.playerId)?.name,
  ).filter((o) => !(['talk', 'casual'].includes(o.kind) && partners.includes(o.target ?? '')));
}
export function physicalOptions(game: Game, a: Agent, now: number, world = game.world.serialize()) {
  return townOptions(game, a, now, world).filter((o) =>
    ['rest', 'eat', 'fish', 'garden', 'cook', 'collect', 'forage'].includes(o.kind),
  );
}
export function activeBoundaries(game: Game, a: Agent) {
  return (a.awareness?.boundaries ?? []).filter(
    (b) => b.expiresAt > (game.world.clock?.elapsedMs ?? 0),
  );
}
export function planCatalog(game: Game, a: Agent, now: number) {
  const places = activityPlaces(game).filter(
    (p) =>
      !game.world.village?.places.some(
        (v) => v.id === p.id && v.kind === 'home' && v.owner !== a.playerId,
      ),
  );
  const options = physicalOptions(game, a, now);
  return {
    maxSteps: 3,
    townActions: townOptions(game, a, now).map(({ score, ...o }) => o),
    places: places.map((p) => ({ id: p.id, name: p.name, position: p.position })),
    durationBounds,
    actions: [
      { action: 'walk', target: 'A place id', duration: 'null; route determines travel time' },
      {
        action: 'wait',
        target: null,
        duration:
          'Choose integer village minutes. Stay at the location reached by preceding steps. waiting is not sleep and does not restrict other residents.',
      },
      ...(options.some((o) => o.kind === 'rest')
        ? [
            {
              action: 'rest',
              target: null,
              duration:
                'Choose maximum village minutes. Ends sooner if energy recovers; does not repay sleep debt.',
            },
          ]
        : []),
      {
        action: 'town',
        target: 'An id from townActions',
        duration:
          'null; completes only when the existing executor confirms the command or task. Later steps recheck actual state; consent and resource yields are not assumed.',
      },
      ...options
        .filter((o) => o.kind !== 'rest')
        .map((o) => ({
          action: o.kind === 'eat' ? 'eat' : 'work',
          target: o.id,
          label: o.label,
          duration:
            o.kind === 'eat'
              ? 'null; eating duration comes from engine'
              : 'Choose maximum working minutes AFTER travel; one existing job, finishes earlier on completion. No guaranteed yield.',
        })),
    ],
    timeScale:
      '1 village minute = 1 simulation second. No example duration or preferred sequence is supplied.',
  };
}
export function validateSteps(game: Game, a: Agent, steps: PlanStep[], now: number) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3)
    throw new Error('Choose 1-3 steps');
  const world = structuredClone(game.world.serialize()),
    p = world.players.find((p) => p.id === a.playerId)!;
  const places = planCatalog(game, a, now).places;
  for (const step of steps) {
    if (!step || !['walk', 'wait', 'rest', 'eat', 'work', 'town'].includes(step.action))
      throw new Error('Unsupported plan step');
    const urgent = emergencyNeed(world.livelihood?.needs.find((n) => n.owner === a.playerId));
    const recovery =
      (urgent === 'food' &&
        (step.action === 'eat' ||
          (step.action === 'work' &&
            ['forage', 'collect-food', 'cook:vegetable', 'cook:fish'].includes(
              step.target ?? '',
            )))) ||
      (urgent === 'energy' && step.action === 'rest');
    if (step.action !== 'town' && step === steps[0] && urgent && !recovery)
      throw new Error('Urgent ' + urgent + ' need must be addressed first');
    if (step.action === 'town') {
      if (step.durationMinutes !== null)
        throw new Error('Town actions have engine-controlled duration');
      if (!townOptions(game, a, now, world).some((o) => o.id === step.target))
        throw new Error('Town action unavailable');
      continue;
    }
    const timed = step.action === 'wait' || step.action === 'rest' || step.action === 'work';
    if (timed) {
      const b = durationBounds[step.action as keyof typeof durationBounds];
      if (
        !Number.isInteger(step.durationMinutes) ||
        step.durationMinutes! < b.min ||
        step.durationMinutes! > b.max
      )
        throw new Error('Duration outside declared bounds');
    } else if (step.durationMinutes !== null)
      throw new Error('Physical duration is engine-controlled');
    if (step.action === 'wait' || step.action === 'rest') {
      if (step.target !== null) throw new Error('Walk to a place before waiting or resting there');
      if (
        step.action === 'rest' &&
        !physicalOptions(game, a, now, world).some((o) => o.kind === 'rest')
      )
        throw new Error('Rest unavailable for current needs');
      continue;
    }
    if (step.action === 'walk') {
      const target = places.find((x) => x.id === step.target);
      if (!target) throw new Error('Unknown or private destination');
      if (Math.hypot(p.position.x - target.position.x, p.position.y - target.position.y) > 0.05) {
        const route = findRoute(
          game,
          now,
          { ...game.world.players.get(a.playerId)!, position: p.position } as any,
          target.position,
        );
        if (!route || route.newDestination) throw new Error('Unreachable destination');
      }
      p.position = { ...target.position };
      continue;
    }
    const option = physicalOptions(game, a, now, world).find(
      (o) =>
        o.id === step.target &&
        (step.action === 'eat'
          ? o.kind === 'eat'
          : ['fish', 'garden', 'cook', 'collect', 'forage'].includes(o.kind)),
    );
    if (!option) throw new Error('Task unavailable with the preceding steps and resources');
    const l = world.livelihood!,
      e = world.economy!,
      g = world.garden!,
      bag = e.bags.find((b) => b.owner === a.playerId)!.items;
    // Project only guaranteed resource effects; never assume a fish will be caught.
    if (option.kind === 'eat' && !eat(l, e, a.playerId, option.food!, now))
      throw new Error('Food unavailable');
    if (option.kind === 'cook') {
      const r = RECIPES[option.recipe!];
      bag.turnips -= r.turnips;
      bag.fish -= r.fish;
      bag.meals = (bag.meals ?? 0) + Math.max(1, r.meals - 1);
    }
    if (option.kind === 'collect') {
      const q = Math.min(4, g.food);
      g.food -= q;
      bag.turnips += q;
    }
    if (option.kind === 'forage') {
      bag.turnips++;
      l.needs.find((n) => n.owner === a.playerId)!.lastForage = l.clock;
    }
  }
}
