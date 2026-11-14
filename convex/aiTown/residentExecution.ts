import type { Game } from './game';
import type { Agent } from './agent';
import type { LifeOption } from './livelihoodActions';
import type { ProposedPlan } from './learnedPlans';
import { validatePlan, selectPlan, initialLearning } from './learnedPlans';
import { Conversation } from './conversation';
import { parseGameId } from './ids';
import { movePlayer, stopPlayer } from './movement';
import { proposeActivity, respondActivity } from './socialActivity';
import { createOffer, respondOffer } from './livelihoodState';
import { REST_MAX_MS } from './sleepState';
import { WORLD_HOUR_MS } from '../../data/worldTime';
export type ResidentExecutionResult = 'completed' | 'running';
// Shared executor: callers validate availability; this function never parses speech.
export function executeResidentOption(
  game: Game,
  now: number,
  agent: Agent,
  option: LifeOption,
  args: { reason: string; source: 'model' | 'fallback'; plan?: ProposedPlan },
  options: LifeOption[],
  stale = false,
  strict = false,
): ResidentExecutionResult | null {
  const result = (state: ResidentExecutionResult) => (strict ? state : null);
  const player = game.world.players.get(agent.playerId)!;
  if (strict && game.world.livelihood && game.world.economy) {
    const l = structuredClone(game.world.livelihood),
      e = structuredClone(game.world.economy);
    if (option.kind === 'offer' && (!option.proposal || !createOffer(l, e, option.proposal, now)))
      throw new Error('Offer unavailable');
    if (
      option.kind === 'respond' &&
      (option.offerId === undefined ||
        !option.response ||
        !respondOffer(l, e, option.offerId, agent.playerId, option.response, now))
    )
      throw new Error('Agreement response unavailable');
  }

  if (option.kind === 'casual' && option.target) {
    const other = game.world.players.get(parseGameId('players', option.target));
    if (other) {
      const result = Conversation.start(game, now, player, other, true);
      agent.lastInviteAttempt = now;
      if (strict && result.error) throw new Error(result.error);
      if (agent.awareness)
        agent.awareness.trigger =
          result.error ?? 'Chose a brief nearby exchange while keeping the current activity';
    }
    agent.nextDecisionAt = now + 30000;
    return result('running');
  }
  if (option.kind === 'quiet') {
    agent.nextDecisionAt = now + 15000;
    player.activity = { description: 'Keeping company quietly', until: now + 15000 };
    return result('running');
  }
  if (option.kind === 'activityOffer' && option.target && option.activityProposal) {
    const ok = proposeActivity(game, agent.playerId, option.target, option.activityProposal, now);
    if (strict && !ok) throw new Error('Invitation unavailable');
    agent.nextDecisionAt = now + 15000;
    return result('completed');
  }
  if (
    option.kind === 'activityResponse' &&
    option.activityId !== undefined &&
    option.activityResponse
  ) {
    const ok = respondActivity(
      game,
      option.activityId,
      agent.playerId,
      option.activityResponse,
      now,
      args.reason,
    );
    if (strict && !ok) throw new Error('Activity response unavailable');
    agent.nextDecisionAt = now + 15000;
    return result(option.activityResponse === 'accept' ? 'running' : 'completed');
  }
  if (option.kind === 'continue') {
    agent.nextDecisionAt = Math.max(now + 10000, agent.decision?.until ?? now + 30000);
    delete agent.suspendedDecision;
    return result('running');
  }
  let plan;
  try {
    plan = stale
      ? undefined
      : validatePlan(
          args.plan,
          option.id,
          options.map((o) => o.id),
        );
  } catch (error) {
    if (strict) throw error;
    return null;
  }
  selectPlan(agent.learning ?? (agent.learning = initialLearning()), option.id, plan);
  const e = game.world.economy,
    g = game.world.garden;
  const target =
    option.target &&
    ['talk', 'visit', 'offer'].includes(option.kind) &&
    game.world.players.get(parseGameId('players', option.target));
  const label = target
    ? option.label.replace(
        option.target!,
        game.playerDescriptions.get(target.id)?.name ?? 'a neighbor',
      )
    : option.label;
  agent.decision = {
    kind: option.kind,
    actionId: option.id,
    destination: option.destination,
    target: option.target,
    label,
    reason: stale
      ? 'The earlier choice became unavailable; follow the current permitted action.'
      : args.reason.slice(0, 160),
    source: stale ? 'fallback' : args.source,
    chosenAt: now,
    until: now + 90000,
  };
  agent.nextDecisionAt = now + 45000;
  // Switching intentions cancels unfinished execution; only completed work grants resources.
  if (e) e.jobs = e.jobs.filter((j) => j.owner !== agent.playerId);
  if (g?.owner === agent.playerId) delete g.job;
  if (game.world.village)
    game.world.village.visits = game.world.village.visits.filter((v) => v.owner !== agent.playerId);
  if (game.world.livelihood)
    game.world.livelihood.jobs = game.world.livelihood.jobs.filter(
      (j) => j.owner !== agent.playerId,
    );
  if (agent.decision.kind !== 'talk' && agent.decision.kind !== 'visit')
    delete agent.suspendedDecision;
  delete agent.sleep;
  delete agent.restStartedClock;
  stopPlayer(player);
  delete player.activity;
  const life = game.world.livelihood;
  if (option.kind === 'sleep' && option.destination) {
    agent.sleep = {
      phase: 'going_home',
      home: option.destination,
      requested: game.world.clock?.elapsedMs ?? life?.clock ?? 0,
    };
    agent.decision.until = now + 10 * WORLD_HOUR_MS;
    agent.nextDecisionAt = agent.decision.until;
    movePlayer(game, now, player, option.destination);
    player.activity = { description: 'Going home to sleep', until: now + 1000 };
  } else if (life && e && ['eat', 'cook', 'collect', 'forage'].includes(option.kind)) {
    life.jobs = life.jobs.filter((j) => j.owner !== agent.playerId);
    life.jobs.push({
      owner: agent.playerId,
      kind: option.kind as 'eat' | 'cook' | 'collect' | 'forage',
      item: option.food,
      recipe: option.recipe,
      requested: life.clock,
    });
    agent.decision.until = now + 150000;
  } else if (life && e && option.kind === 'offer' && option.proposal) {
    const ok = createOffer(life, e, option.proposal, now);
    if (strict && !ok) throw new Error('Offer unavailable');
    agent.decision.until = now + 5000;
    agent.nextDecisionAt = now + 15000;
    return result('completed');
  } else if (
    life &&
    e &&
    option.kind === 'respond' &&
    option.offerId !== undefined &&
    option.response
  ) {
    const ok = respondOffer(life, e, option.offerId, agent.playerId, option.response, now);
    if (strict && !ok) throw new Error('Agreement response unavailable');
    agent.decision.until = now + 5000;
    agent.nextDecisionAt = now + 15000;
    return result(option.response === 'accept' ? 'running' : 'completed');
  } else if (option.kind === 'place' && game.world.village) {
    game.world.village.visits = game.world.village.visits.filter((v) => v.owner !== agent.playerId);
    game.world.village.visits.push({ owner: agent.playerId, placeId: option.target! });
  } else if (option.kind === 'talk' && target) {
    const result = Conversation.start(game, now, player, target);
    agent.lastInviteAttempt = now;
    if (strict && result.error) throw new Error(result.error);
    if (result.error) {
      if (agent.awareness) agent.awareness.trigger = result.error;
      agent.decision.until = now;
      agent.nextDecisionAt = now + 15000;
    }
  } else if ((option.kind === 'visit' || option.kind === 'walk') && option.destination) {
    movePlayer(game, now, player, option.destination);
  } else if (option.kind === 'wander') {
    const destination = {
      x: Math.max(
        1,
        Math.min(
          game.worldMap.width - 2,
          Math.round(player.position.x) + Math.floor(Math.random() * 9) - 4,
        ),
      ),
      y: Math.max(
        1,
        Math.min(
          game.worldMap.height - 2,
          Math.round(player.position.y) + Math.floor(Math.random() * 9) - 4,
        ),
      ),
    };
    if (strict) agent.decision.destination = destination;
    movePlayer(game, now, player, destination);
  } else if (option.kind === 'rest') {
    agent.restStartedClock = game.world.clock?.elapsedMs ?? life?.clock ?? 0;
    agent.decision.until = now + REST_MAX_MS;
    agent.nextDecisionAt = agent.decision.until;
    player.activity = { description: 'Resting to recover', until: agent.decision.until };
  } else if (option.kind === 'market' && e) {
    agent.decision.until = now + 45000;
    movePlayer(game, now, player, { x: e.market.x + 1, y: e.market.y + 1 });
  } else if (e && g && ['fish', 'trade', 'deposit'].includes(option.kind)) {
    // Resource changes happen only at the destination, in the existing work executor.
    e.jobs = e.jobs.filter((j) => j.owner !== agent.playerId);
    e.jobs.push({
      owner: agent.playerId,
      kind: option.kind as 'fish' | 'trade' | 'deposit',
      requested: g.time,
    });
  }
  return result('running');
}
