import { reviewBasis } from './jointThreeStage';
import { validateDecisionWords } from './jointResponse';
import { executeResidentOption } from './residentExecution';
import { v } from 'convex/values';
import type { Game } from './game';
import { parseGameId } from './ids';
import { inputHandler } from './inputHandler';
import { conversationInputs } from './conversation';
import { stopPlayer } from './movement';
import { emergencyNeed } from './physicalPriority';
import { planStep, walkInvitation, planCatalog, validateSteps, townOptions } from './planActions';
import { planEvent } from './spokenPlan';
import { journal } from './decisionJournal';

export const jointMessage = v.object({
  conversationId: v.string(),
  playerId: v.string(),
  partner: v.string(),
  speakerName: v.string(),
  text: v.string(),
  messageUuid: v.string(),
  operationId: v.string(),
  action: v.string(),
  ended: v.boolean(),
  at: v.number(),
});
export const jointTurnArgs = {
  agentId: v.string(),
  conversationId: v.string(),
  operationId: v.string(),
  messageUuid: v.string(),
  expectedMessages: v.number(),
  action: v.string(),
  steps: v.array(planStep),
  invitation: v.union(walkInvitation, v.null()),
  speech: v.string(),
  decisionWords: v.optional(
    v.array(
      v.object({
        action: v.string(),
        durationMinutes: v.union(v.number(), v.null()),
        words: v.string(),
      }),
    ),
  ),
  reviewBasis: v.optional(v.string()),
  reason: v.string(),
  actionError: v.optional(v.string()),
};

export function jointContext(game: Game, agentId: string, conversationId: string, now: number) {
  const a = game.world.agents.get(parseGameId('agents', agentId)),
    c = game.world.conversations.get(parseGameId('conversations', conversationId));
  if (!a || !c || !c.participants.has(a.playerId)) return null;
  const partnerId = [...c.participants.keys()].find((id) => id !== a.playerId)!;
  const other = [...game.world.agents.values()].find((x) => x.playerId === partnerId);
  const name = game.playerDescriptions.get(a.playerId)?.name,
    partner = game.playerDescriptions.get(partnerId)?.name;
  if (
    !other ||
    !((name === 'Bob' && partner === 'Lucky') || (name === 'Lucky' && partner === 'Bob'))
  )
    return null;
  const l = game.world.livelihood;
  const catalog = planCatalog(game, a, now);
  const knownPlan = other.spokenPlan?.conversationId === c.id ? other.spokenPlan : null;
  const closing = knownPlan?.state === 'pending';
  const options: { id: string; effect: string }[] = closing
    ? []
    : [{ id: 'chat', effect: 'Speak without creating a physical action or promise.' }];
  options.push({
    id: 'end',
    effect: closing
      ? 'Acknowledge the partner’s committed plan and end this encounter. No movement chosen.'
      : 'End this encounter. No movement chosen.',
  });
  const urgent = emergencyNeed(l?.needs.find((n) => n.owner === a.playerId));
  const busy =
    !!a.sleep ||
    l?.offers.some(
      (o) => ['accepted', 'cooking'].includes(o.status) && o.participants.includes(a.playerId),
    ) ||
    l?.activities?.some(
      (s) =>
        ['scheduled', 'gathering', 'active'].includes(s.status) &&
        s.participants.includes(a.playerId),
    );
  if (!busy)
    options.push({
      id: 'plan',
      effect:
        'Choose 1-3 supported steps and their parameters from the catalogue using your own needs and preferences. Allow one acknowledgment before execution; if this is already the closing turn, end now.',
    });
  const town = townOptions(game, a, now);
  const names = Object.fromEntries(
    [...game.playerDescriptions.values()].map((p) => [p.playerId, p.name]),
  );
  for (const o of town) {
    const label =
      o.target && names[o.target] ? o.label.split(o.target).join(names[o.target]) : o.label;
    options.push({
      id: o.id,
      effect: label + ' — ' + actionEffect(o),
    });
  }
  const invitation = l?.activities?.find(
    (s) => s.status === 'proposed' && s.participants.includes(a.playerId),
  );
  return {
    a,
    c,
    other,
    name: name!,
    partner: partner!,
    catalog,
    town,
    options,
    invitation,
    knownPlan,
    urgent,
  };
}

export const jointConversationInputs = {
  finishJointTurn: inputHandler({
    args: jointTurnArgs,
    handler: (game, now, args) => {
      const x = jointContext(game, args.agentId, args.conversationId, now);
      if (!x) return null;
      const { a, c, other } = x;
      if (
        a.inProgressOperation?.name !== 'agentGenerateMessage' ||
        a.inProgressOperation.operationId !== args.operationId
      )
        return null;
      // Only stale turns and missing speech are discarded. Action errors are separate.
      if (c.numMessages !== args.expectedMessages ||
          c.participants.get(a.playerId)?.status.kind !== 'participating' || !args.speech.trim()) {
        delete a.inProgressOperation;
        delete c.isTyping;
        return null;
      }
      let planError: string | undefined = args.actionError;
      try {
        if (args.reviewBasis !== undefined && args.reviewBasis !== reviewBasis(game, a))
          throw new Error('World facts changed; action not committed');
        if (!x.options.some(o => o.id === args.action)) throw new Error('Action unavailable');
        validateDecisionWords(args);
        if (args.action === 'plan') {
          if (args.invitation !== null)
            throw new Error('A personal plan cannot also invite another person');
          validateSteps(game, a, args.steps, now);
        } else if (args.steps.length) throw new Error('Only plan may contain physical steps');
        if (args.invitation !== null) throw new Error('Use a supported town invitation action');
      } catch (e) {
        planError = e instanceof Error ? e.message : 'Invalid parameters';
      }
      let action = planError ? 'chat' : args.action;
      const clock = game.world.clock?.elapsedMs ?? 0;
      const selected = x.town.find((o) => o.id === action);
      const immediate =
        selected &&
        ['offer', 'respond', 'activityOffer', 'activityResponse', 'quiet'].includes(selected.kind);
      try {
        if (immediate)
          executeResidentOption(
            game,
            now,
            a,
            selected,
            { reason: args.reason, source: 'model' },
            x.town,
            false,
            true,
          );
      } catch (error) {
        planError = error instanceof Error ? error.message : 'Action unavailable';
        action = 'chat';
      }
      if (planError) journal(game, args.operationId, a.playerId, now, 'cancelled',
        'Action rejected; speech retained: ' + planError);
      const steps =
        planError ? [] : action === 'plan'
          ? args.steps
          : selected && !immediate
            ? [{ action: 'town' as const, target: selected.id, durationMinutes: null }]
            : [];
      if (steps.length) {
        a.spokenPlan = {
          id: args.operationId,
          conversationId: c.id,
          partner: other.playerId,
          steps: steps.map((step) => ({ ...step })),
          index: 0,
          state: 'pending',
          requested: clock,
          reason: args.reason,
          events: [],
        };
        if (steps[0].action !== 'town') {
          if (game.world.economy)
            game.world.economy.jobs = game.world.economy.jobs.filter((j) => j.owner !== a.playerId);
          if (game.world.livelihood)
            game.world.livelihood.jobs = game.world.livelihood.jobs.filter(
              (j) => j.owner !== a.playerId,
            );
          if (game.world.garden?.owner === a.playerId) delete game.world.garden.job;
          if (game.world.village)
            game.world.village.visits = game.world.village.visits.filter(
              (j) => j.owner !== a.playerId,
            );
          delete a.suspendedDecision;
          delete a.decision;
          stopPlayer(game.world.players.get(a.playerId)!);
        }
        planEvent(game, a, now, 'plan_committed');
      }
      const ended =
        action === 'end' ||
        (!planError && (!!(selected?.response === 'accept' || selected?.activityResponse === 'accept') ||
        x.knownPlan?.state === 'pending')); 
      delete a.inProgressOperation;
      conversationInputs.finishSendingMessage.handler(game, now, {
        playerId: a.playerId,
        conversationId: c.id,
        timestamp: now,
      });
      game.jointMessages.push({
        conversationId: c.id,
        playerId: a.playerId,
        partner: other.playerId,
        speakerName: x.name,
        text: args.speech.trim(),
        messageUuid: args.messageUuid,
        operationId: args.operationId,
        action,
        ended,
        at: now,
      });
      journal(
        game,
        args.operationId,
        a.playerId,
        now,
        'committed',
        `Spoke and selected ${action}`,
        {
          dataJson: JSON.stringify({
            action,
            steps,
            invitation: args.invitation,
            speech: args.speech,
            decisionWords: args.decisionWords,
            reason: args.reason,
          }),
        },
      );
      if (ended) c.leave(game, now, game.world.players.get(a.playerId)!);
      return null;
    },
  }),
};

function actionEffect(o: ReturnType<typeof townOptions>[number]): string {
  switch (o.kind) {
    case 'place':
      return 'Travel to the entrance/courtyard and stay briefly. No food, purchase, cooking, eating, sleep or shared invitation is included.';
    case 'walk':
    case 'wander':
    case 'visit':
      return 'Move only; visiting a resident goes to their last known location. Does not start work, feed you, invite anyone or guarantee meeting them.';
    case 'eat':
      return (
        'Consume one carried ' +
        o.food +
        ' and reduce hunger after the eating task. Requires that food in inventory.'
      );
    case 'cook':
      return 'Consume the selected recipe ingredients and prepare meals. Does not eat them or supply another resident without an agreement.';
    case 'fish':
      return 'Travel to the river and attempt one catch. Fish may be added only on success. Does not cook or eat the fish.';
    case 'forage':
    case 'collect':
      return 'Travel and collect food into inventory after work completes. Does not eat it.';
    case 'garden':
      return 'Travel and perform one available planting or harvesting task. Does not automatically collect stored harvest into inventory or eat it.';
    case 'sleep':
      return 'Travel to your own home and sleep; recovery occurs while sleeping.';
    case 'rest':
      return 'Recover energy during a short rest; does not repay sleep debt or provide food.';
    case 'offer':
      return (
        'Create only these proposed terms: ' +
        JSON.stringify(o.proposal) +
        '. No transfer until the required participants consent and the exchange completes.'
      );
    case 'respond':
      return (
        'Apply ' +
        o.response +
        ' to agreement #' +
        o.offerId +
        '. Declining/countering does not transfer goods. Accepting does not mean goods have already arrived; only the selected agreement terms apply.'
      );
    case 'activityOffer':
      return (
        'Propose only ' +
        JSON.stringify(o.activityProposal) +
        ' to resident ' +
        o.target +
        '. They decide whether to accept; this is not an accepted joint plan.'
      );
    case 'activityResponse':
      return (
        'Apply ' +
        o.activityResponse +
        ' to existing shared activity #' +
        o.activityId +
        '. Only that invitation is affected; declining does not start another activity.'
      );
    case 'talk':
    case 'casual':
      return 'Attempt a conversation with the selected resident. No agreement, trip or shared activity is created.';
    case 'quiet':
      return 'Keep company quietly. No movement, meal or new invitation.';
    case 'continue':
      return 'Continue the current task with its existing effects; does not add another task.';
    case 'deposit':
      return 'Travel home and move carried seeds into garden storage. No planting or trade.';
    case 'market':
      return 'Travel to the market and tend the stall. No automatic meal or exchange.';
    case 'trade':
      return 'Execute the available trade using actual goods; does not eat them.';
    case 'joint':
      return 'Continue only the already accepted shared activity; no new invitation or agreement.';
  }
}
