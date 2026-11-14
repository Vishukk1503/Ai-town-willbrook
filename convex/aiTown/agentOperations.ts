import {generateJointTurn} from '../townJoint';
import {parseLiveDialogue} from './dialogueState';
import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent } from './agent';
import { ACTIVITIES, ACTIVITY_COOLDOWN, CONVERSATION_COOLDOWN } from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    try { await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    ); } finally {
      await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishRememberConversation',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
      });
    }
  },
});
export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),
    type: v.union(v.literal('start'), v.literal('continue'), v.literal('leave')),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    if(await generateJointTurn(ctx,args))return;
    let completionFn;
    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;
      case 'continue':
        completionFn = continueConversationMessage;
        break;
      case 'leave':
        completionFn = leaveConversationMessage;
        break;
      default:
        assertNever(args.type);
    }
    try {
      const rawText = await completionFn(ctx,args.worldId,
        args.conversationId as GameId<'conversations'>,
        args.playerId as GameId<'players'>,args.otherPlayerId as GameId<'players'>,
        args.operationId);
      const {dialogue,actionError}=parseLiveDialogue(rawText);
      await ctx.runMutation(internal.aiTown.agent.agentSendMessage,{
        worldId:args.worldId,conversationId:args.conversationId,agentId:args.agentId,playerId:args.playerId,
        text:dialogue.speech,dialogue,...(actionError?{actionError}:{}),
        messageUuid:args.messageUuid,
        leaveConversation:args.type==='leave'||!dialogue.continueConversation,
        operationId:args.operationId,
      });
    } catch(error) {
      if(!await ctx.runQuery(internal.modelSettings.active,{worldId:args.worldId,operationId:args.operationId}))return;
      await ctx.runMutation(internal.aiTown.agent.agentSendMessage,{
        worldId:args.worldId,conversationId:args.conversationId,agentId:args.agentId,playerId:args.playerId,
        text:'',messageUuid:args.messageUuid,leaveConversation:true,operationId:args.operationId,
        guardReason:error instanceof Error?error.message:'provider_or_invalid_output',
      });
    }
  },
});
export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { player, agent } = args;
    const map = new WorldMap(args.map);
    const now = Date.now();
    // Don't try to start a new conversation if we were just in one.
    const justLeftConversation =
      agent.lastConversation && now < agent.lastConversation + CONVERSATION_COOLDOWN;
    // Don't try again if we recently tried to find someone to invite.
    const recentlyAttemptedInvite =
      agent.lastInviteAttempt && now < agent.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const recentActivity = player.activity && now < player.activity.until + ACTIVITY_COOLDOWN;
    // Decide whether to do an activity or wander somewhere.
    if (!player.pathfinding && (args.otherFreePlayers.length === 0 || justLeftConversation || recentlyAttemptedInvite || Math.random() < 0.3)) {
      if (recentActivity || justLeftConversation) {
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination: wanderDestination(map, player.position),
          },
        });
        return;
      } else {
        // TODO: have LLM choose the activity & emoji
        const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            activity: {
              description: activity.description,
              emoji: activity.emoji,
              until: Date.now() + activity.duration,
            },
          },
        });
        return;
      }
    }
    const invitee =
      justLeftConversation || recentlyAttemptedInvite
        ? undefined
        : await ctx.runQuery(internal.aiTown.agent.findConversationCandidate, {
            now,
            worldId: args.worldId,
            player: args.player,
            otherFreePlayers: args.otherFreePlayers,
          });
    // TODO: We hit a lot of OCC errors on sending inputs in this file. It's
    // easy for them to get scheduled at the same time and line up in time.
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishDoSomething',
      args: {
        operationId: args.operationId,
        agentId: args.agent.id,
        invitee,
      },
    });
  },
});
function wanderDestination(worldMap: WorldMap, position: {x:number;y:number}) {
  // Stay in the neighborhood so three agents can meet without crossing the entire map.
  return {
    x: Math.max(1,Math.min(worldMap.width-2,Math.round(position.x)+(Math.floor(Math.random()*13)-6))),
    y: Math.max(1,Math.min(worldMap.height-2,Math.round(position.y)+(Math.floor(Math.random()*13)-6))),
  };
}
