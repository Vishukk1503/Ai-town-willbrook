// Admin-only, bounded verification against the actual paused town. Does not
// change needs/personas or prescribe dialogue. Other model calls stay suspended.
import { v } from 'convex/values';
import { internalMutation, internalAction, internalQuery, MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { loadTownGame, generateJointTurn } from './townJoint';
import { Game } from './aiTown/game';
import { Conversation } from './aiTown/conversation';
import { stopPlayer } from './aiTown/movement';
import { Id } from './_generated/dataModel';

async function paused(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { game, status } = await loadTownGame(ctx.db, worldId);
  if (status.status !== 'stoppedByDeveloper' || game.engine.running)
    throw new Error('Test requires the town explicitly paused');
  return game;
}
function drainOperations(game: Game, conversationId: string) {
  const turns = game.pendingOperations.filter(
    (o) => o.name === 'agentGenerateMessage' && o.args.conversationId === conversationId,
  );
  for (const op of game.pendingOperations)
    if (!turns.includes(op)) {
      const a = [...game.world.agents.values()].find((a) => a.id === op.args.agentId);
      if (!a) continue;
      if (a.inProgressOperation?.operationId === op.args.operationId) {
        delete a.inProgressOperation;
        a.nextDecisionAt = Date.now() + 1000;
      }
      if (a.memoryOperation?.operationId === op.args.operationId) {
        delete a.memoryOperation;
        if (!a.memoryQueue.includes(op.args.conversationId))
          a.memoryQueue.unshift(op.args.conversationId);
      }
    }
  game.pendingOperations = [];
  return turns.map((o) => o.args);
}
export const start = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const game = await paused(ctx, worldId),
      now = Date.now();
    const residents = ['Lucky', 'Bob'].map((name) =>
      [...game.world.agents.values()].find(
        (a) => game.playerDescriptions.get(a.playerId)?.name === name,
      )!,
    );
    if (residents.some((a) => !a)) throw new Error('Bob or Lucky missing');
    if (residents.some((a) => game.world.playerConversation(game.world.players.get(a.playerId)!)))
      throw new Error('Residents already in an encounter');
    // Rebase paused paths before advancing the real world; do not teleport actors.
    for (const p of game.world.players.values())
      if (p.pathfinding) {
        p.pathfinding.state = { kind: 'needsPath' };
        p.pathfinding.started = now;
      }
    game.world.clock ??= { elapsedMs: 0 };
    game.world.clock.lastTick = now;
    game.tick(now);
    drainOperations(game, '');
    if (residents.some((a) => a.sleep)) {
      await Game.saveDiff(ctx, worldId, game.takeDiff());
      await ctx.db.patch(game.engine._id, { currentTime: now });
      return { waitingForSleep: true, started: now };
    }
    const [lucky, bob] = residents.map((a) => game.world.players.get(a.playerId)!);
    const result = Conversation.start(game, now, lucky, bob);
    if (!result.conversationId) throw new Error(result.error);
    game.world.conversations.get(result.conversationId)!.acceptInvite(game, bob);
    stopPlayer(lucky);
    stopPlayer(bob);
    await Game.saveDiff(ctx, worldId, game.takeDiff());
    await ctx.db.patch(game.engine._id, { currentTime: now });
    return {
      conversationId: result.conversationId,
      started: now,
      positions: residents.map((a) => ({
        name: game.playerDescriptions.get(a.playerId)!.name,
        position: game.world.players.get(a.playerId)!.position,
      })),
      needs: game.world.livelihood?.needs,
    };
  },
});
export const step = internalMutation({
  args: { worldId: v.id('worlds'), conversationId: v.string() },
  handler: async (ctx, { worldId, conversationId }) => {
    const game = await paused(ctx, worldId),
      end = Date.now(),
      start = Math.max(game.engine.currentTime ?? end, end - 2000);
    const pending = await ctx.db
      .query('inputs')
      .withIndex('byInputNumber', (q) =>
        q.eq('engineId', game.engine._id).gt('number', game.engine.processedInputNumber ?? -1),
      )
      .order('asc')
      .take(32);
    let processed = game.engine.processedInputNumber;
    for (const input of pending) {
      try {
        game.handleInput(start, input.name as any, input.args);
        await ctx.db.patch(input._id, { returnValue: { kind: 'ok', value: null } });
      } catch (e) {
        await ctx.db.patch(input._id, {
          returnValue: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
        });
      }
      processed = input.number;
    }
    const samples: { at: number; clock: number; name: string; x: number; y: number }[] = [];
    for (let now = start; now <= end; now += 100) {
      game.numPathfinds = 0;
      game.tick(now);
      for (const a of game.world.agents.values())
        if (['Bob', 'Lucky'].includes(game.playerDescriptions.get(a.playerId)?.name ?? '')) {
          const p = game.world.players.get(a.playerId)!;
          samples.push({
            at: now,
            clock: game.world.clock!.elapsedMs,
            name: game.playerDescriptions.get(a.playerId)!.name,
            x: p.position.x,
            y: p.position.y,
          });
        }
    }
    const turns = drainOperations(game, conversationId),
      c = game.world.conversations.get(conversationId as any);
    const actors = [...game.world.agents.values()].filter((a) =>
      ['Bob', 'Lucky'].includes(game.playerDescriptions.get(a.playerId)?.name ?? ''),
    );
    const state = actors.map((a) => ({
      name: game.playerDescriptions.get(a.playerId)!.name,
      plan: a.spokenPlan ?? null,
      decision: a.decision ?? null,
      path: game.world.players.get(a.playerId)!.pathfinding ?? null,
      sleep: a.sleep ?? null,
      position: game.world.players.get(a.playerId)!.position,
      needs: game.world.livelihood?.needs.find((n) => n.owner === a.playerId),
      inventory: game.world.economy?.bags.find((b) => b.owner === a.playerId)?.items,
    }));
    const sharedActivities =
      game.world.livelihood?.activities?.filter((s) =>
        actors.every((a) => s.participants.includes(a.playerId)),
      ) ?? [];
    await Game.saveDiff(ctx, worldId, game.takeDiff());
    await ctx.db.patch(game.engine._id, {
      currentTime: end,
      ...(processed !== undefined ? { processedInputNumber: processed } : {}),
    });
    return {
      turns,
      conversationOpen: !!c,
      numMessages: c?.numMessages ?? null,
      state,
      samples,
      sharedActivities,
      agreements:
        game.world.livelihood?.offers.filter((o) =>
          o.participants.some((id) => actors.some((a) => a.playerId === id)),
        ) ?? [],
      active:
        actors.some(
          (a) =>
            a.spokenPlan?.conversationId === conversationId &&
            !['done', 'interrupted'].includes(a.spokenPlan.state),
        ) ||
        sharedActivities.some((s) => ['scheduled', 'gathering', 'active'].includes(s.status)) ||
        !!game.world.livelihood?.offers.some(
          (o) =>
            ['accepted', 'cooking'].includes(o.status) &&
            o.participants.some((id) => actors.some((a) => a.playerId === id)),
        ),
    };
  },
});
export const turn = internalAction({
  args: { args: v.any() },
  handler: async (ctx, { args }): Promise<{ ms: number }> => {
    await ctx.runQuery(internal.townJointTest.verify, {
      worldId: args.worldId,
      conversationId: args.conversationId,
    });
    const start = Date.now();
    await generateJointTurn(ctx, args, true);
    return { ms: Date.now() - start };
  },
});
export const verify = internalQuery({
  args: { worldId: v.id('worlds'), conversationId: v.string() },
  handler: async (ctx, { worldId, conversationId }) => {
    const { game, status } = await loadTownGame(ctx.db, worldId);
    if (
      status.status !== 'stoppedByDeveloper' ||
      game.engine.running ||
      !game.world.conversations.has(conversationId as any)
    )
      throw new Error('Manual verification is not active');
    return true;
  },
});
