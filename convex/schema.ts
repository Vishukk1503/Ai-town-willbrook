import {dialogueState,dialogueDecision} from './aiTown/dialogueState';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentTables } from './agent/schema';
import { aiTownTables } from './aiTown/schema';
import { conversationId, playerId } from './aiTown/ids';
import { engineTables } from './engine/schema';
import { graphTables } from './agent/graphSchema';
import {modelTables} from './agent/modelSchema';

export default defineSchema({
  decisionAudits:defineTable({worldId:v.id('worlds'),operationId:v.string(),playerId:v.string(),requestedAt:v.number(),clock:v.number(),updatedAt:v.number(),status:v.string(),contextJson:v.optional(v.string()),chosenAt:v.optional(v.number()),finishedAt:v.optional(v.number()),requestedAction:v.optional(v.string()),actionId:v.optional(v.string()),kind:v.optional(v.string()),label:v.optional(v.string()),reason:v.optional(v.string()),source:v.optional(v.string()),bodyJson:v.optional(v.string()),menuJson:v.optional(v.string()),relatedKey:v.optional(v.string()),parentKey:v.optional(v.string()),outcome:v.optional(v.string())}).index('operation',['worldId','operationId']).index('resident',['worldId','playerId']).index('world',['worldId']).index('related',['worldId','relatedKey']),
  decisionEvents:defineTable({worldId:v.id('worlds'),eventKey:v.string(),operationId:v.string(),playerId:v.string(),at:v.number(),clock:v.number(),phase:v.string(),summary:v.string(),relatedKey:v.optional(v.string()),dataJson:v.optional(v.string())}).index('world',['worldId']).index('eventKey',['worldId','eventKey']).index('operation',['worldId','operationId']).index('resident',['worldId','playerId']),
  dialogueTurns:defineTable({worldId:v.id('worlds'),operationId:v.string(),conversationId:v.string(),speaker:v.string(),partner:v.string(),intent:v.string(),status:v.string(),reason:v.optional(v.string()),repairReason:v.optional(v.string()),ended:v.boolean(),at:v.number()}).index('world',['worldId']).index('operation',['worldId','operationId']),
  ...graphTables,
  ...modelTables,
  councilSessions: defineTable({
    background: v.string(), topic: v.string(), rounds: v.number(), testMode:v.optional(v.boolean()), dialogue:v.optional(dialogueState), endReason:v.optional(v.string()),
    status: v.string(), nextTurn: v.number(), attempt:v.optional(v.number()), error: v.optional(v.string()),
    worldId: v.optional(v.id('worlds')),
    participants: v.optional(v.array(v.object({playerId:v.string(),name:v.string(),persona:v.string(),plan:v.string()}))),
  }),
  councilMessages: defineTable({
    sessionId: v.id('councilSessions'), speaker: v.string(), text: v.string(),
    round: v.number(), seconds: v.number(), decision:v.optional(dialogueDecision), repairReason:v.optional(v.string()),
    memoriesUsed: v.optional(v.number()), townMessagesUsed: v.optional(v.number()),
  }).index('session', ['sessionId']),
  worldLore: defineTable({worldId:v.id('worlds'),background:v.string()}).index('world',['worldId']),
  music: defineTable({
    storageId: v.string(),
    type: v.union(v.literal('background'), v.literal('player')),
  }),

  messages: defineTable({
    conversationId,
    messageUuid: v.string(),
    author: playerId,
    text: v.string(),
    worldId: v.optional(v.id('worlds')),
  })
    .index('conversationId', ['worldId', 'conversationId'])
    .index('messageUuid', ['conversationId', 'messageUuid']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
