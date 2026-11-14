import { v, Infer } from 'convex/values';
import type { Game } from './game';
import type { Agent } from './agent';
import { movePlayer, stopPlayer, findRoute } from './movement';
import { emergencyNeed } from './physicalPriority';
import { WORLD_MINUTE_MS } from '../../data/worldTime';
import { journal } from './decisionJournal';
import { planStep, physicalOptions, validateSteps, townOptions } from './planActions';
import { activityPlaces } from './socialActivity';
import { REST_RECOVERED } from './sleepState';
import { livelihoodWork } from './livelihoodRuntime';
import { economyWork } from './economyRuntime';
import { workGarden } from './gardenState';
import { executeResidentOption } from './residentExecution';

export const spokenPlan = v.object({
  id: v.string(),
  conversationId: v.string(),
  partner: v.string(),
  // Optional legacy fields allow existing saved/archived records to load. They
  // are never offered to a model or silently converted to a new duration.
  choice: v.optional(v.string()),
  destination: v.optional(v.object({ x: v.number(), y: v.number() })),
  steps: v.optional(v.array(planStep)),
  index: v.optional(v.number()),
  state: v.union(
    v.literal('pending'),
    v.literal('walking'),
    v.literal('waiting'),
    v.literal('resting'),
    v.literal('working'),
    v.literal('eating'),
    v.literal('delegated'),
    v.literal('done'),
    v.literal('interrupted'),
  ),
  requested: v.number(),
  waitUntil: v.optional(v.number()),
  deadline: v.optional(v.number()),
  workStarted: v.optional(v.number()),
  taskKind: v.optional(v.string()),
  eventCursor: v.optional(v.number()),
  execution: v.optional(
    v.object({
      deadline: v.number(),
      chosenAt: v.optional(v.number()),
      until: v.optional(v.number()),
      reference: v.optional(v.number()),
      conversation: v.optional(v.string()),
      destination: v.optional(v.object({ x: v.number(), y: v.number() })),
    }),
  ),
  reason: v.optional(v.string()),
  events: v.array(
    v.object({
      kind: v.string(),
      at: v.number(),
      clock: v.number(),
      x: v.number(),
      y: v.number(),
      step: v.optional(v.number()),
    }),
  ),
});
export type SpokenPlan = Infer<typeof spokenPlan>;
export function planEvent(game: Game, a: Agent, now: number, kind: string) {
  const p = game.world.players.get(a.playerId)!,
    s = a.spokenPlan!,
    clock = game.world.clock?.elapsedMs ?? 0;
  s.events.push({ kind, at: now, clock, x: p.position.x, y: p.position.y, step: s.index });
  journal(
    game,
    s.id,
    a.playerId,
    now,
    kind,
    `${s.steps?.[s.index ?? 0]?.action ?? 'Plan'}: ${kind}`,
    {
      status:
        kind === 'completed' ? 'completed' : kind === 'interrupted' ? 'interrupted' : 'active',
      dataJson: JSON.stringify(s),
    },
  );
}
function clearWork(game: Game, a: Agent) {
  if (game.world.economy)
    game.world.economy.jobs = game.world.economy.jobs.filter((j) => j.owner !== a.playerId);
  if (game.world.livelihood)
    game.world.livelihood.jobs = game.world.livelihood.jobs.filter((j) => j.owner !== a.playerId);
  if (game.world.garden?.owner === a.playerId) delete game.world.garden.job;
  if (a.decision?.kind === 'rest') delete a.decision;
}
export function interruptSpokenPlan(game: Game, a: Agent, now: number, reason: string) {
  const s = a.spokenPlan;
  if (!s || ['done', 'interrupted'].includes(s.state)) return;
  s.state = 'interrupted';
  s.reason = reason;
  clearWork(game, a);
  stopPlayer(game.world.players.get(a.playerId)!);
  delete game.world.players.get(a.playerId)!.activity;
  a.nextDecisionAt = now;
  if (a.awareness) a.awareness.trigger = 'Spoken plan interrupted: ' + reason;
  planEvent(game, a, now, 'interrupted');
}
export function tickSpokenPlan(game: Game, a: Agent, now: number): boolean {
  const s = a.spokenPlan,
    p = game.world.players.get(a.playerId);
  if (!s || !p || ['done', 'interrupted'].includes(s.state)) return false;
  if (!s.steps?.length) {
    interruptSpokenPlan(
      game,
      a,
      now,
      'Older plan needs reconsideration with explicit steps and duration',
    );
    return false;
  }
  s.index ??= 0;
  const step = s.steps[s.index],
    clock = game.world.clock?.elapsedMs ?? 0,
    l = game.world.livelihood,
    e = game.world.economy,
    g = game.world.garden;
  const advance = (cleanup = true) => {
    planEvent(game, a, now, 'step_completed');
    if (cleanup) {
      clearWork(game, a);
      stopPlayer(p);
      delete p.activity;
    }
    s.index!++;
    delete s.waitUntil;
    delete s.deadline;
    delete s.workStarted;
    delete s.taskKind;
    delete s.eventCursor;
    delete s.destination;
    delete s.execution;
    if (s.index! >= s.steps!.length) {
      s.state = 'done';
      a.nextDecisionAt = now + 1000;
      planEvent(game, a, now, 'completed');
    } else s.state = 'pending';
  };
  // Submission is not completion. The delegated executor must supply evidence
  // for this step before the sequence advances; disappearing jobs are failures.
  if (s.state === 'delegated') {
    const result = delegatedResult(game, a, now);
    if (result === 'completed') {
      advance();
      return true;
    }
    if (result === 'failed') {
      interruptSpokenPlan(game, a, now, 'Town action ended without confirmed completion');
      return false;
    }
    a.nextDecisionAt = Math.max(a.nextDecisionAt ?? 0, now + 1000);
    if (a.awareness) a.awareness.nextReaction = Math.max(a.awareness.nextReaction, now + 1000);
    return false; // Existing town workers drive running jobs and accepted agreements.
  }
  const urgent = emergencyNeed(l?.needs.find((n) => n.owner === a.playerId));
  const recovery =
    (urgent === 'food' &&
      (step.action === 'eat' ||
        (step.action === 'work' &&
          ['forage', 'collect-food', 'cook:vegetable', 'cook:fish'].includes(
            step.target ?? '',
          )))) ||
    (urgent === 'energy' && step.action === 'rest');
  if (step.action !== 'town' && urgent && !recovery) {
    interruptSpokenPlan(game, a, now, 'Urgent ' + urgent + ' need');
    return false;
  }
  const conversation = game.world.playerConversation(p);
  if (conversation) {
    if (s.state === 'pending' && s.index === 0 && conversation.id === s.conversationId)
      return false;
    conversation.leave(game, now, p);
  }
  if (s.state === 'pending') {
    try {
      validateSteps(game, a, [step], now);
    } catch (e) {
      interruptSpokenPlan(game, a, now, e instanceof Error ? e.message : 'Step unavailable');
      return false;
    }
    if (step.action === 'town') {
      const options = townOptions(game, a, now),
        option = options.find((o) => o.id === step.target)!;
      const kind = option.kind === 'continue' ? a.decision?.kind : option.kind;
      const source = ['fish', 'trade', 'deposit'].includes(kind ?? '')
        ? e
        : kind === 'garden'
          ? g
          : kind === 'place'
            ? game.world.village
            : l;
      s.eventCursor = source?.nextEvent;
      let result;
      try {
        result = executeResidentOption(
          game,
          now,
          a,
          option,
          { reason: s.reason ?? 'Chosen action', source: 'model' },
          options,
          false,
          true,
        );
      } catch (error) {
        interruptSpokenPlan(
          game,
          a,
          now,
          error instanceof Error ? error.message : 'Town action unavailable',
        );
        return false;
      }
      s.taskKind = kind;
      planEvent(game, a, now, 'town_action_started');
      if (result === 'completed') {
        planEvent(game, a, now, 'command_applied');
        advance(false); // Preserve command effects; the next step revalidates them.
        return true;
      }
      s.state = 'delegated';
      const obligation =
        option.offerId === undefined ? undefined : l?.offers.find((o) => o.id === option.offerId);
      const activity =
        option.activityId === undefined
          ? undefined
          : l?.activities?.find((o) => o.id === option.activityId);
      const expires = activity?.hardExpires ?? obligation?.expires;
      s.execution = {
        deadline:
          expires !== undefined
            ? now + Math.max(0, expires - (l?.clock ?? clock))
            : kind === 'quiet'
              ? now + 15000
              : (a.decision?.until ?? a.nextDecisionAt ?? now),
        chosenAt: a.decision?.chosenAt,
        until: kind === 'quiet' ? now + 15000 : a.decision?.until,
        reference: option.offerId ?? option.activityId,
        conversation: game.world.playerConversation(p)?.id,
        destination: a.decision?.destination,
      };
      a.nextDecisionAt = Math.max(a.nextDecisionAt ?? 0, now + 1000);
      return false;
    }
    delete a.decision;
    delete a.suspendedDecision;
    delete p.activity;
    if (step.action === 'walk') {
      s.destination = { ...activityPlaces(game).find((x) => x.id === step.target)!.position };
      const route =
        Math.hypot(p.position.x - s.destination.x, p.position.y - s.destination.y) < 0.05
          ? true
          : findRoute(game, now, p, s.destination);
      if (!route || (typeof route !== 'boolean' && route.newDestination)) {
        interruptSpokenPlan(game, a, now, 'Destination unreachable');
        return false;
      }
      s.state = 'walking';
      s.deadline = clock + 240000;
      movePlayer(game, now, p, s.destination);
      planEvent(game, a, now, 'movement_started');
    } else if (step.action === 'wait' || step.action === 'rest') {
      s.state = step.action === 'wait' ? 'waiting' : 'resting';
      s.waitUntil = clock + step.durationMinutes! * WORLD_MINUTE_MS;
      stopPlayer(p);
      if (step.action === 'rest')
        a.decision = {
          kind: 'rest',
          label: 'Resting for a chosen duration',
          reason: s.reason ?? 'Chosen recovery',
          source: 'model',
          chosenAt: now,
          until: now + 1000,
        };
      planEvent(game, a, now, step.action === 'wait' ? 'wait_started' : 'rest_started');
    } else {
      const option = physicalOptions(game, a, now).find((o) => o.id === step.target)!;
      s.state = step.action === 'eat' ? 'eating' : 'working';
      s.taskKind = option.kind;
      s.deadline = clock + 240000;
      s.eventCursor =
        option.kind === 'fish'
          ? e!.nextEvent
          : option.kind === 'garden'
            ? g!.nextEvent
            : l!.nextEvent;
      if (option.kind === 'fish')
        e!.jobs.push({ owner: a.playerId, kind: 'fish', requested: g!.time });
      else if (option.kind !== 'garden')
        l!.jobs.push({
          owner: a.playerId,
          kind: option.kind as 'eat' | 'cook' | 'collect' | 'forage',
          item: option.food,
          recipe: option.recipe,
          requested: l!.clock,
        });
      planEvent(game, a, now, 'task_started');
    }
  }
  if (s.state === 'walking') {
    p.activity = {
      description: 'Walking to ' + activityPlaces(game).find((x) => x.id === step.target)?.name,
      until: now + 1000,
    };
    if (Math.hypot(p.position.x - s.destination!.x, p.position.y - s.destination!.y) < 0.05) {
      planEvent(game, a, now, 'arrived');
      advance();
    } else if (clock >= s.deadline! || !p.pathfinding)
      interruptSpokenPlan(game, a, now, 'Route interrupted before arrival');
  } else if (s.state === 'waiting' || s.state === 'resting') {
    stopPlayer(p);
    p.activity = {
      description:
        s.state === 'waiting' ? 'Waiting for a chosen duration' : 'Resting for a chosen duration',
      until: now + 1000,
    };
    if (s.state === 'resting' && a.decision) a.decision.until = now + 1000;
    const recovered =
      s.state === 'resting' &&
      (l?.needs.find((n) => n.owner === a.playerId)?.energy ?? 0) >= REST_RECOVERED;
    if (clock >= s.waitUntil! || recovered) {
      planEvent(
        game,
        a,
        now,
        recovered ? 'recovered' : s.state === 'waiting' ? 'wait_completed' : 'rest_completed',
      );
      advance();
    }
  } else if (s.state === 'working' || s.state === 'eating') {
    if (s.waitUntil !== undefined && clock > s.waitUntil) {
      interruptSpokenPlan(
        game,
        a,
        now,
        'Chosen work time exhausted; unfinished task produced nothing',
      );
      return false;
    }
    let workStarted: number | undefined,
      hasJob = false,
      completed = false;
    if (s.taskKind === 'fish') {
      economyWork(game, a.playerId, now);
      workStarted = e!.jobs.find((j) => j.owner === a.playerId)?.started;
      hasJob = e!.jobs.some((j) => j.owner === a.playerId);
      completed = e!.events.some(
        (ev) => ev.id >= s.eventCursor! && ev.kind === 'fish' && ev.witnesses.includes(a.playerId),
      );
    } else if (s.taskKind === 'garden') {
      const result = workGarden(g!, p.position, now);
      if (result?.destination && !p.pathfinding) movePlayer(game, now, p, result.destination);
      if (result) p.activity = { description: result.label, until: now + 1000 };
      workStarted = g!.job?.started;
      hasJob = !!g!.job;
      completed = g!.events.some(
        (ev) => ev.id >= s.eventCursor! && ['plant', 'harvest'].includes(ev.kind),
      );
      if (completed && g!.events.at(-1)?.kind === 'harvest' && l) l.produced.turnips += 2;
    } else {
      livelihoodWork(game, a.playerId, now);
      workStarted = l!.jobs.find((j) => j.owner === a.playerId)?.started;
      hasJob = l!.jobs.some((j) => j.owner === a.playerId);
      completed = l!.events.some(
        (ev) =>
          ev.id >= s.eventCursor! && ev.kind === s.taskKind && ev.witnesses.includes(a.playerId),
      );
    }
    if (s.workStarted === undefined && workStarted !== undefined) {
      s.workStarted = clock;
      if (step.durationMinutes !== null)
        s.waitUntil = clock + step.durationMinutes * WORLD_MINUTE_MS;
      planEvent(game, a, now, 'work_started');
    }
    if (completed) {
      planEvent(game, a, now, 'task_completed');
      advance();
    } else if (
      !hasJob ||
      clock >= s.deadline! ||
      (s.waitUntil !== undefined && clock >= s.waitUntil)
    )
      interruptSpokenPlan(
        game,
        a,
        now,
        s.waitUntil !== undefined && clock >= s.waitUntil
          ? 'Chosen work time exhausted; unfinished task produced nothing'
          : 'Task became unavailable before completion',
      );
  }
  return s.state !== 'interrupted';
}

function delegatedResult(game: Game, a: Agent, now: number): 'completed' | 'running' | 'failed' {
  const s = a.spokenPlan!,
    ticket = s.execution,
    kind = s.taskKind,
    p = game.world.players.get(a.playerId)!,
    l = game.world.livelihood,
    e = game.world.economy,
    g = game.world.garden;
  // Old saved handoffs have no execution receipt; never infer success from idleness.
  if (!ticket) return 'failed';
  if (kind === 'respond' || kind === 'activityResponse') {
    const record =
      kind === 'respond'
        ? l?.offers.find((o) => o.id === ticket.reference)
        : l?.activities?.find((o) => o.id === ticket.reference);
    if (record?.status === 'completed') return 'completed';
    return record &&
      ['open', 'accepted', 'cooking', 'proposed', 'scheduled', 'gathering', 'active'].includes(
        record.status,
      )
      ? 'running'
      : 'failed';
  }
  if (kind === 'talk' || kind === 'casual')
    return ticket.conversation &&
      [...game.world.conversations.values()].some((c) => c.id === ticket.conversation)
      ? 'running'
      : 'completed';
  if (kind === 'quiet') return now >= ticket.until! ? 'completed' : 'running';
  const source = ['fish', 'trade', 'deposit'].includes(kind ?? '')
    ? e
    : kind === 'garden'
      ? g
      : kind === 'place'
        ? game.world.village
        : l;
  const events = [...(source?.events ?? [])].filter((ev) => ev.id >= (s.eventCursor ?? Infinity));
  const confirmed = events.some((ev) => {
    if ('owner' in ev) return ev.owner === a.playerId;
    if ('witnesses' in ev && Array.isArray(ev.witnesses) && !ev.witnesses.includes(a.playerId))
      return false;
    return (
      'kind' in ev &&
      (kind === 'sleep'
        ? ev.kind === 'wake'
        : kind === 'garden'
          ? ['plant', 'harvest'].includes(ev.kind)
          : ev.kind === kind)
    );
  });
  if (confirmed) return 'completed';
  if (now > ticket.deadline) return 'failed';
  if (kind === 'sleep') return a.sleep ? 'running' : 'failed';
  if (a.decision?.chosenAt !== ticket.chosenAt) return 'failed';
  if (['walk', 'visit', 'wander'].includes(kind ?? '')) {
    if (
      ticket.destination &&
      Math.hypot(p.position.x - ticket.destination.x, p.position.y - ticket.destination.y) < 0.65
    )
      return 'completed';
    return p.pathfinding ? 'running' : 'failed';
  }
  if (kind === 'rest') {
    const n = l?.needs.find((n) => n.owner === a.playerId);
    return (n && n.energy >= REST_RECOVERED) || now >= ticket.until! ? 'completed' : 'running';
  }
  if (kind === 'market') return now >= ticket.until! ? 'completed' : 'running';
  const hasJob =
    e?.jobs.some((j) => j.owner === a.playerId) ||
    l?.jobs.some((j) => j.owner === a.playerId) ||
    (g?.owner === a.playerId && (g.job || (kind === 'garden' && now < a.decision!.until))) ||
    game.world.village?.visits.some((v) => v.owner === a.playerId);
  return hasJob ? 'running' : 'failed';
}
