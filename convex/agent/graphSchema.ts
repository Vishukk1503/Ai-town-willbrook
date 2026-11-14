import { defineTable } from 'convex/server';
import { v } from 'convex/values';
const scores={familiarity:v.number(),affection:v.number(),trust:v.number(),safety:v.number(),respect:v.number(),tension:v.number()};
export const graphTables = {
  characterSheets:defineTable({worldId:v.id('worlds'),playerId:v.string(),name:v.string(),
    traits:v.object({curiosity:v.number(),sociability:v.number(),caution:v.number(),routine:v.number(),assertiveness:v.number(),vulnerability:v.number(),rejectionSensitivity:v.number(),autonomy:v.number()}),
    values:v.array(v.string()),boundary:v.string(),stressResponse:v.string(),source:v.literal('authored-v1'),
  }).index('player',['worldId','playerId']),
  relationshipBaselines:defineTable({worldId:v.id('worlds'),owner:v.string(),target:v.string(),targetName:v.string(),scores:v.object(scores),story:v.string(),source:v.literal('authored-v1'),
  }).index('owner',['worldId','owner']),
  relationshipChanges:defineTable({worldId:v.id('worlds'),owner:v.string(),target:v.string(),eventId:v.id('memoryEvents'),occurredAt:v.number(),kind:v.string(),sentiment:v.string(),delta:v.object({familiarity:v.optional(v.number()),affection:v.optional(v.number()),trust:v.optional(v.number()),safety:v.optional(v.number()),respect:v.optional(v.number()),tension:v.optional(v.number())}),
  }).index('edge',['worldId','owner','target','occurredAt']).index('event',['eventId','owner','target']),
  characterBeliefs: defineTable({
    worldId:v.id('worlds'), owner:v.string(), subject:v.string(), subjectName:v.string(),
    statement:v.string(), eventId:v.id('memoryEvents'), occurredAt:v.number(),
    supersedes:v.optional(v.id('characterBeliefs')),
  }).index('owner',['worldId','owner','occurredAt']),
  characterPromises: defineTable({
    worldId:v.id('worlds'), owner:v.string(), promiser:v.string(), promiserName:v.string(),
    task:v.string(), eventId:v.id('memoryEvents'), occurredAt:v.number(),
    resolutionEventId:v.optional(v.id('memoryEvents')),
    resolution:v.optional(v.union(v.literal('reported_done'),v.literal('withdrawn'))),
  }).index('owner',['worldId','owner','occurredAt'])
    .index('owner_resolution',['worldId','owner','resolution','occurredAt'])
    .index('promiser_resolution',['worldId','owner','promiser','resolution','occurredAt']),
  memoryEvents: defineTable({
    worldId: v.id('worlds'), source: v.string(), context: v.string(),
    speaker: v.string(), speakerName: v.string(), text: v.string(),
    witnesses: v.array(v.string()), occurredAt: v.number(), inactive: v.boolean(),
    signalsProcessed:v.optional(v.boolean()),
  }).index('source', ['worldId', 'source']),
  memoryPerspectives: defineTable({
    worldId: v.id('worlds'), owner: v.string(), eventId: v.id('memoryEvents'),
    kind: v.union(v.literal('said'), v.literal('heard'),v.literal('did')),
    occurredAt: v.number(),
  }).index('owner', ['worldId', 'owner', 'occurredAt']),
};

