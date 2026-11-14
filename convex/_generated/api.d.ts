/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_actionPromises from "../agent/actionPromises.js";
import type * as agent_conversation from "../agent/conversation.js";
import type * as agent_embeddingsCache from "../agent/embeddingsCache.js";
import type * as agent_graphSchema from "../agent/graphSchema.js";
import type * as agent_memory from "../agent/memory.js";
import type * as agent_memorySignals from "../agent/memorySignals.js";
import type * as agent_modelSchema from "../agent/modelSchema.js";
import type * as agent_socialRules from "../agent/socialRules.js";
import type * as aiTown_actionChoice from "../aiTown/actionChoice.js";
import type * as aiTown_actionFacts from "../aiTown/actionFacts.js";
import type * as aiTown_actionSchema from "../aiTown/actionSchema.js";
import type * as aiTown_agent from "../aiTown/agent.js";
import type * as aiTown_agentDescription from "../aiTown/agentDescription.js";
import type * as aiTown_agentInputs from "../aiTown/agentInputs.js";
import type * as aiTown_agentOperations from "../aiTown/agentOperations.js";
import type * as aiTown_awareness from "../aiTown/awareness.js";
import type * as aiTown_behaviorTree from "../aiTown/behaviorTree.js";
import type * as aiTown_conversation from "../aiTown/conversation.js";
import type * as aiTown_conversationMembership from "../aiTown/conversationMembership.js";
import type * as aiTown_decisionJournal from "../aiTown/decisionJournal.js";
import type * as aiTown_dialogueController from "../aiTown/dialogueController.js";
import type * as aiTown_dialogueState from "../aiTown/dialogueState.js";
import type * as aiTown_economyInputs from "../aiTown/economyInputs.js";
import type * as aiTown_economyRuntime from "../aiTown/economyRuntime.js";
import type * as aiTown_economyState from "../aiTown/economyState.js";
import type * as aiTown_game from "../aiTown/game.js";
import type * as aiTown_gardenState from "../aiTown/gardenState.js";
import type * as aiTown_ids from "../aiTown/ids.js";
import type * as aiTown_inputHandler from "../aiTown/inputHandler.js";
import type * as aiTown_inputs from "../aiTown/inputs.js";
import type * as aiTown_insertInput from "../aiTown/insertInput.js";
import type * as aiTown_jointConversation from "../aiTown/jointConversation.js";
import type * as aiTown_jointResponse from "../aiTown/jointResponse.js";
import type * as aiTown_jointThreeStage from "../aiTown/jointThreeStage.js";
import type * as aiTown_jointWorldFacts from "../aiTown/jointWorldFacts.js";
import type * as aiTown_learnedPlans from "../aiTown/learnedPlans.js";
import type * as aiTown_livelihoodActions from "../aiTown/livelihoodActions.js";
import type * as aiTown_livelihoodRuntime from "../aiTown/livelihoodRuntime.js";
import type * as aiTown_livelihoodState from "../aiTown/livelihoodState.js";
import type * as aiTown_location from "../aiTown/location.js";
import type * as aiTown_main from "../aiTown/main.js";
import type * as aiTown_manualMovement from "../aiTown/manualMovement.js";
import type * as aiTown_movement from "../aiTown/movement.js";
import type * as aiTown_physicalPriority from "../aiTown/physicalPriority.js";
import type * as aiTown_planActions from "../aiTown/planActions.js";
import type * as aiTown_player from "../aiTown/player.js";
import type * as aiTown_playerDescription from "../aiTown/playerDescription.js";
import type * as aiTown_repetitionFeedback from "../aiTown/repetitionFeedback.js";
import type * as aiTown_residentExecution from "../aiTown/residentExecution.js";
import type * as aiTown_resumeState from "../aiTown/resumeState.js";
import type * as aiTown_sleepState from "../aiTown/sleepState.js";
import type * as aiTown_socialActivity from "../aiTown/socialActivity.js";
import type * as aiTown_socialActivityTypes from "../aiTown/socialActivityTypes.js";
import type * as aiTown_socialBoundary from "../aiTown/socialBoundary.js";
import type * as aiTown_socialOpportunity from "../aiTown/socialOpportunity.js";
import type * as aiTown_spokenPlan from "../aiTown/spokenPlan.js";
import type * as aiTown_villageState from "../aiTown/villageState.js";
import type * as aiTown_world from "../aiTown/world.js";
import type * as aiTown_worldClock from "../aiTown/worldClock.js";
import type * as aiTown_worldMap from "../aiTown/worldMap.js";
import type * as atmosphere from "../atmosphere.js";
import type * as bobLuckyComparisonTest from "../bobLuckyComparisonTest.js";
import type * as bobLuckyPrototype from "../bobLuckyPrototype.js";
import type * as constants from "../constants.js";
import type * as council from "../council.js";
import type * as councilContext from "../councilContext.js";
import type * as crons from "../crons.js";
import type * as decisionHistory from "../decisionHistory.js";
import type * as decisionHistoryStore from "../decisionHistoryStore.js";
import type * as dialogueReview from "../dialogueReview.js";
import type * as economy from "../economy.js";
import type * as engine_abstractGame from "../engine/abstractGame.js";
import type * as engine_historicalObject from "../engine/historicalObject.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as livelihood from "../livelihood.js";
import type * as memoryGraph from "../memoryGraph.js";
import type * as messages from "../messages.js";
import type * as modelReply from "../modelReply.js";
import type * as modelSettings from "../modelSettings.js";
import type * as music from "../music.js";
import type * as prototypes_bobLuckyFlow from "../prototypes/bobLuckyFlow.js";
import type * as residentActions from "../residentActions.js";
import type * as settlement from "../settlement.js";
import type * as social from "../social.js";
import type * as testing from "../testing.js";
import type * as townJoint from "../townJoint.js";
import type * as townJointTest from "../townJointTest.js";
import type * as util_FastIntegerCompression from "../util/FastIntegerCompression.js";
import type * as util_assertNever from "../util/assertNever.js";
import type * as util_asyncMap from "../util/asyncMap.js";
import type * as util_compression from "../util/compression.js";
import type * as util_geometry from "../util/geometry.js";
import type * as util_isSimpleObject from "../util/isSimpleObject.js";
import type * as util_llm from "../util/llm.js";
import type * as util_minheap from "../util/minheap.js";
import type * as util_modelCosts from "../util/modelCosts.js";
import type * as util_modelTransport from "../util/modelTransport.js";
import type * as util_object from "../util/object.js";
import type * as util_sleep from "../util/sleep.js";
import type * as util_types from "../util/types.js";
import type * as util_xxhash from "../util/xxhash.js";
import type * as village from "../village.js";
import type * as world from "../world.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/actionPromises": typeof agent_actionPromises;
  "agent/conversation": typeof agent_conversation;
  "agent/embeddingsCache": typeof agent_embeddingsCache;
  "agent/graphSchema": typeof agent_graphSchema;
  "agent/memory": typeof agent_memory;
  "agent/memorySignals": typeof agent_memorySignals;
  "agent/modelSchema": typeof agent_modelSchema;
  "agent/socialRules": typeof agent_socialRules;
  "aiTown/actionChoice": typeof aiTown_actionChoice;
  "aiTown/actionFacts": typeof aiTown_actionFacts;
  "aiTown/actionSchema": typeof aiTown_actionSchema;
  "aiTown/agent": typeof aiTown_agent;
  "aiTown/agentDescription": typeof aiTown_agentDescription;
  "aiTown/agentInputs": typeof aiTown_agentInputs;
  "aiTown/agentOperations": typeof aiTown_agentOperations;
  "aiTown/awareness": typeof aiTown_awareness;
  "aiTown/behaviorTree": typeof aiTown_behaviorTree;
  "aiTown/conversation": typeof aiTown_conversation;
  "aiTown/conversationMembership": typeof aiTown_conversationMembership;
  "aiTown/decisionJournal": typeof aiTown_decisionJournal;
  "aiTown/dialogueController": typeof aiTown_dialogueController;
  "aiTown/dialogueState": typeof aiTown_dialogueState;
  "aiTown/economyInputs": typeof aiTown_economyInputs;
  "aiTown/economyRuntime": typeof aiTown_economyRuntime;
  "aiTown/economyState": typeof aiTown_economyState;
  "aiTown/game": typeof aiTown_game;
  "aiTown/gardenState": typeof aiTown_gardenState;
  "aiTown/ids": typeof aiTown_ids;
  "aiTown/inputHandler": typeof aiTown_inputHandler;
  "aiTown/inputs": typeof aiTown_inputs;
  "aiTown/insertInput": typeof aiTown_insertInput;
  "aiTown/jointConversation": typeof aiTown_jointConversation;
  "aiTown/jointResponse": typeof aiTown_jointResponse;
  "aiTown/jointThreeStage": typeof aiTown_jointThreeStage;
  "aiTown/jointWorldFacts": typeof aiTown_jointWorldFacts;
  "aiTown/learnedPlans": typeof aiTown_learnedPlans;
  "aiTown/livelihoodActions": typeof aiTown_livelihoodActions;
  "aiTown/livelihoodRuntime": typeof aiTown_livelihoodRuntime;
  "aiTown/livelihoodState": typeof aiTown_livelihoodState;
  "aiTown/location": typeof aiTown_location;
  "aiTown/main": typeof aiTown_main;
  "aiTown/manualMovement": typeof aiTown_manualMovement;
  "aiTown/movement": typeof aiTown_movement;
  "aiTown/physicalPriority": typeof aiTown_physicalPriority;
  "aiTown/planActions": typeof aiTown_planActions;
  "aiTown/player": typeof aiTown_player;
  "aiTown/playerDescription": typeof aiTown_playerDescription;
  "aiTown/repetitionFeedback": typeof aiTown_repetitionFeedback;
  "aiTown/residentExecution": typeof aiTown_residentExecution;
  "aiTown/resumeState": typeof aiTown_resumeState;
  "aiTown/sleepState": typeof aiTown_sleepState;
  "aiTown/socialActivity": typeof aiTown_socialActivity;
  "aiTown/socialActivityTypes": typeof aiTown_socialActivityTypes;
  "aiTown/socialBoundary": typeof aiTown_socialBoundary;
  "aiTown/socialOpportunity": typeof aiTown_socialOpportunity;
  "aiTown/spokenPlan": typeof aiTown_spokenPlan;
  "aiTown/villageState": typeof aiTown_villageState;
  "aiTown/world": typeof aiTown_world;
  "aiTown/worldClock": typeof aiTown_worldClock;
  "aiTown/worldMap": typeof aiTown_worldMap;
  atmosphere: typeof atmosphere;
  bobLuckyComparisonTest: typeof bobLuckyComparisonTest;
  bobLuckyPrototype: typeof bobLuckyPrototype;
  constants: typeof constants;
  council: typeof council;
  councilContext: typeof councilContext;
  crons: typeof crons;
  decisionHistory: typeof decisionHistory;
  decisionHistoryStore: typeof decisionHistoryStore;
  dialogueReview: typeof dialogueReview;
  economy: typeof economy;
  "engine/abstractGame": typeof engine_abstractGame;
  "engine/historicalObject": typeof engine_historicalObject;
  http: typeof http;
  init: typeof init;
  livelihood: typeof livelihood;
  memoryGraph: typeof memoryGraph;
  messages: typeof messages;
  modelReply: typeof modelReply;
  modelSettings: typeof modelSettings;
  music: typeof music;
  "prototypes/bobLuckyFlow": typeof prototypes_bobLuckyFlow;
  residentActions: typeof residentActions;
  settlement: typeof settlement;
  social: typeof social;
  testing: typeof testing;
  townJoint: typeof townJoint;
  townJointTest: typeof townJointTest;
  "util/FastIntegerCompression": typeof util_FastIntegerCompression;
  "util/assertNever": typeof util_assertNever;
  "util/asyncMap": typeof util_asyncMap;
  "util/compression": typeof util_compression;
  "util/geometry": typeof util_geometry;
  "util/isSimpleObject": typeof util_isSimpleObject;
  "util/llm": typeof util_llm;
  "util/minheap": typeof util_minheap;
  "util/modelCosts": typeof util_modelCosts;
  "util/modelTransport": typeof util_modelTransport;
  "util/object": typeof util_object;
  "util/sleep": typeof util_sleep;
  "util/types": typeof util_types;
  "util/xxhash": typeof util_xxhash;
  village: typeof village;
  world: typeof world;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
