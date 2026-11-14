import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { modelReply } from './modelReply';
import { BobLuckyFlow, Intent } from './prototypes/bobLuckyFlow';
import { Conversation } from './aiTown/conversation';
import { characterContext } from '../data/characterContext';

export const preflight = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (status?.status === 'running')
      throw new Error('Pause the town before running the isolated prototype.');
    const budget = await ctx.db.query('modelBudgets').first();
    if (
      !budget ||
      budget.limitMicros - budget.safetyMicros - budget.spentMicros - budget.reservedMicros < 150000
    )
      throw new Error('Less than $0.15 remains under the existing spending stop.');
    return true;
  },
});
export const usage = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const requests = await ctx.db.query('modelRequests').order('desc').take(100);
    return requests.filter((r) => r.key.startsWith(runId + ':')).map(({ content, ...r }) => r);
  },
});

// Admin-only, three-turn controlled scene. No changes to the running world.
// Each turn chooses intention and speech in one call; no verifier or repair call.
export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ runId: string; traceJson: string }> => {
    await ctx.runQuery(internal.bobLuckyPrototype.preflight, {});
    const cast = (await ctx.runQuery(internal.dialogueReview.probeCast, {})).cast;
    const runId = 'bob-lucky:' + crypto.randomUUID(),
      flow = new BobLuckyFlow(),
      started = Date.now();
    const turns: any[] = [],
      initial = JSON.parse(JSON.stringify(flow.snapshot()));
    let error: string | null = null,
      reapproachError: string | null = null;
    try {
      while (flow.phase !== 'closed' && turns.length < 3) {
        const actor = flow.actor(),
          resident = cast.find((p) => p.name === actor);
        if (!resident) throw new Error('Resident missing: ' + actor);
        const turn: any = {
          actor,
          observation: flow.observe(),
          before: JSON.parse(JSON.stringify(flow.snapshot())),
        };
        turns.push(turn);
        const t0 = Date.now(),
          identity = JSON.stringify(characterContext(actor, resident.persona, resident.plan));
        const personalMotive =
          actor === 'Bob'
            ? 'You currently want company for a walk. You do not know Lucky’s private preferences; learn them from what Lucky says.'
            : 'You currently want one hour alone. Choose whether to go home first and spend the hour there, or wait here for the hour and then go home.';
        const scene = `${personalMotive} You are well fed, rested and free of urgent duties. You and your neighbor are standing together at 10:00 in the village. World facts below override biography memories. When currentState is present, use its committed plan and invitation status as current facts; the transcript contains earlier suggestions that may have been declined. Choose only your own action; the options list states the complete effects. A reason is a preference, not an extra activity.`;
        const messages = [
          {
            role: 'system',
            content: `You are ${actor}. Character: ${identity}\n${scene}\nChoose your intention and your spoken words together. Return intent, reason (under 20 words), and speech (one or two short sentences, maximum 350 characters). The engine will execute the selected intention. Match your words to its duration, destination and effects; do not add unselected promises or claim movement has already happened. Write your own dialogue, with no stage directions.`,
          },
          { role: 'user', content: JSON.stringify(flow.observe()) },
        ];
        turn.prompt = messages;
        const reply = await modelReply(ctx, {
          actor,
          scope: 'prototype-joint',
          requestKey: runId + ':' + flow.revision + ':joint',
          outputContract: 'speech',
          maxTokens: 512,
          responseSchema: {
            type: 'object',
            properties: {
              intent: { type: 'string', enum: flow.menu() },
              reason: { type: 'string' },
              speech: { type: 'string' },
            },
            required: ['intent', 'reason', 'speech'],
            additionalProperties: false,
          },
          messages,
        });
        turn.rawResponse = reply.content;
        const decision = JSON.parse(reply.content);
        if (typeof decision.reason !== 'string' || typeof decision.speech !== 'string')
          throw new Error('Invalid joint decision');
        const ticket = flow.prepare(actor, decision.intent as Intent);
        turn.decision = decision;
        turn.ticket = ticket;
        flow.commit(ticket, decision.speech);
        turn.speech = decision.speech;
        turn.totalMs = Date.now() - t0;
        turn.after = JSON.parse(JSON.stringify(flow.snapshot()));
      }
      if (flow.phase !== 'closed') throw new Error('Three-turn bound exhausted');
      if (flow.invitationId !== undefined) {
        reapproachError =
          Conversation.start(flow.game, flow.now, flow.player('Bob'), flow.player('Lucky')).error ??
          null;
        if (!reapproachError) throw new Error('Boundary failed to prevent re-approach');
      }
      flow.executeMovement();
      if (flow.paths.some((p) => !p.arrived)) throw new Error('Approved movement did not finish');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const requests = await ctx.runQuery(internal.bobLuckyPrototype.usage, { runId });
    return {
      runId,
      traceJson: JSON.stringify({
        runId,
        isolated: true,
        scenario: 'Bob offers a walk; Lucky prefers solitude',
        initial,
        turns,
        error,
        reapproachError,
        final: flow.snapshot(),
        paths: flow.paths,
        requests,
        generationAndExecutionWallMs: Date.now() - started,
        limitations: [
          'Controlled refusal menu; not emergent preference',
          'Production pathfinding and conversation primitives in an isolated map; no autonomous agent scheduler',
          'No world database persistence or UI rollout',
          'Speech semantics require review; JSON validity alone cannot prove wording matches intent',
        ],
      }),
    };
  },
});
