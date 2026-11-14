import {executeResidentOption} from './residentExecution';
import {emergencyNeed} from './physicalPriority';
import {rememberBoundary,boundaryFromSpeech,ownBoundary} from './socialBoundary';
import {auditChoice,journal} from './decisionJournal';
import {REST_MAX_MS} from './sleepState';
import {WORLD_HOUR_MS} from '../../data/worldTime';
import {dialogueDecision,initialDialogue,applyDialogue} from './dialogueState';
import {proposeActivity,respondActivity} from './socialActivity';
import {proposedPlan,validatePlan,selectPlan,initialLearning} from './learnedPlans';
import {initialAwareness,canSee} from './awareness';
import { v } from 'convex/values';
import { agentId, conversationId, parseGameId } from './ids';
import { Player, activity } from './player';
import { Conversation, conversationInputs } from './conversation';
import { movePlayer } from './movement';
import { inputHandler } from './inputHandler';
import { point } from '../util/types';
import { Descriptions } from '../../data/characters';
import { AgentDescription } from './agentDescription';
import { Agent } from './agent';
import {availableActions} from './actionChoice';
import {stopPlayer} from './movement';
import {createOffer,respondOffer,lifeEvent} from './livelihoodState';

export const agentInputs = {
  failedDialogue:inputHandler({args:{agentId,operationId:v.string(),reason:v.optional(v.string())},handler:(game,now,args)=>{
    const agent=game.world.agents.get(parseGameId('agents',args.agentId));
    if(!agent||agent.inProgressOperation?.operationId!==args.operationId||agent.inProgressOperation.name!=='agentGenerateMessage')return null;
    delete agent.inProgressOperation;
    const player=game.world.players.get(agent.playerId);
    if(player){const conversation=game.world.playerConversation(player);if(conversation)conversation.leave(game,now,player);player.activity={description:args.reason&&args.reason!=='provider_or_invalid_output'?'Taking a natural pause; returning to village life':'Conversation unavailable; returning to village life',until:now+10000};}
    agent.nextDecisionAt=now+5000;
    return null;
  }}),
  finishDecision: inputHandler({args:{operationId:v.string(),agentId,action:v.string(),reason:v.string(),auditNote:v.optional(v.string()),plan:v.optional(proposedPlan),abandonPlan:v.optional(v.boolean()),source:v.union(v.literal('model'),v.literal('fallback'))},handler:(game,now,args)=>{return auditChoice(game,now,args,()=>{
    const agent=game.world.agents.get(parseGameId('agents',args.agentId));
    if(!agent||agent.inProgressOperation?.operationId!==args.operationId)return null;
    delete agent.inProgressOperation;
    if(agent.spokenPlan&&!['done','interrupted'].includes(agent.spokenPlan.state))return null;
    const player=game.world.players.get(agent.playerId);
    if(!player||game.world.playerConversation(player))return null;
    const name=game.playerDescriptions.get(agent.playerId)?.name??'';
    const options=availableActions({...game.world.serialize(),awareness:agent.awareness??initialAwareness(),currentDecision:agent.decision,lastWakeClock:agent.lastWakeClock},agent.playerId,now,agent.lastInviteAttempt,agent.lastConversation,name);
    if(agent.awareness)agent.awareness.scores=options.slice().sort((a,b)=>b.score-a.score).slice(0,5).map(o=>({label:o.label,score:Math.round(o.score)}));
    let option=options.find(o=>o.id===args.action),stale=false;
    if(!option||(option.kind==='talk'&&(!option.target||!game.world.players.get(parseGameId('players',option.target))||!canSee(game.worldMap,player.position,game.world.players.get(parseGameId('players',option.target))!.position)))){
      option=emergencyNeed(game.world.livelihood?.needs.find(n=>n.owner===agent.playerId))?options[0]:options.find(o=>o.id==='wander')??options.find(o=>o.id==='quiet');stale=true;
      if(!option){agent.nextDecisionAt=now+5000;return null;}
    }
    if(args.abandonPlan&&args.plan)return null;
    if(!stale&&args.source==='model'&&args.abandonPlan)selectPlan(agent.learning??(agent.learning=initialLearning()),option.id,undefined,true);
    return executeResidentOption(game,now,agent,option,args,options,stale);
    });
  }}),
  finishRememberConversation: inputHandler({
    args: {
      operationId: v.string(),
      agentId,
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if(agent.memoryOperation?.operationId===args.operationId){delete agent.memoryOperation;return null;}
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} isn't remembering ${args.operationId}`);
      } else {
        delete agent.inProgressOperation;
        delete agent.toRemember;
      }
      return null;
    },
  }),
  finishDoSomething: inputHandler({
    args: {
      operationId: v.string(),
      agentId: v.id('agents'),
      destination: v.optional(point),
      invitee: v.optional(v.id('players')),
      activity: v.optional(activity),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} didn't have ${args.operationId} in progress`);
        return null;
      }
      delete agent.inProgressOperation;
      const player = game.world.players.get(agent.playerId)!;
      if (args.invitee) {
        const inviteeId = parseGameId('players', args.invitee);
        const invitee = game.world.players.get(inviteeId);
        if (!invitee) {
          throw new Error(`Couldn't find player: ${inviteeId}`);
        }
        Conversation.start(game, now, player, invitee);
        agent.lastInviteAttempt = now;
      }
      if (args.destination) {
        movePlayer(game, now, player, args.destination);
      }
      if (args.activity) {
        player.activity = args.activity;
      }
      return null;
    },
  }),
  agentFinishSendingMessage: inputHandler({
    args: {
      agentId,
      conversationId,
      timestamp: v.number(),
      operationId: v.string(),
      leaveConversation: v.boolean(),
      dialogue:v.optional(dialogueDecision),
      actionError:v.optional(v.string()),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      const player = game.world.players.get(agent.playerId);
      if (!player) {
        throw new Error(`Couldn't find player: ${agent.playerId}`);
      }
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Couldn't find conversation: ${conversationId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} wasn't sending a message ${args.operationId}`);
        return null;
      }
      delete agent.inProgressOperation;
      conversationInputs.finishSendingMessage.handler(game, now, {
        playerId: agent.playerId,
        conversationId: args.conversationId,
        timestamp: args.timestamp,
      });
      if(args.actionError)journal(game,args.operationId,agent.playerId,now,'cancelled','Action rejected; speech retained: '+args.actionError);
      if(args.dialogue){
        const d=args.dialogue;const requested=d.boundary;
        if(requested)for(const member of conversation.participants.values()){if(member.playerId===agent.playerId)continue;const listener=[...game.world.agents.values()].find(a=>a.playerId===member.playerId);if(listener){listener.awareness??=initialAwareness();listener.awareness.boundaries=rememberBoundary(listener.awareness.boundaries,agent.playerId,member.playerId,requested,d.speech,game.world.clock?.elapsedMs??0);}}
        applyDialogue(conversation.dialogue??(conversation.dialogue=initialDialogue()),agent.playerId,d);
        const partner=[...conversation.participants.keys()].find(id=>id!==agent.playerId);
        try {
          if(requested?.scope!=='contact'&&d.proposal&&partner&&!proposeActivity(game,agent.playerId,partner,d.proposal,now))
            throw Error('Shared activity proposal unavailable');
          if(d.response!=='none'&&d.proposalId!==null&&!respondActivity(game,d.proposalId,agent.playerId,d.response,now))
            throw Error('Shared activity response unavailable');
        } catch(error) {
          journal(game,args.operationId,agent.playerId,now,'cancelled',
            'Action rejected; speech retained: '+(error instanceof Error?error.message:'Action unavailable'));
        }
        const clock=game.world.livelihood?.clock??now;
        if(d.privateConcern==='')delete agent.privateConcern;
        if(d.privateConcern&&(!agent.privateConcern||clock-agent.privateConcern.since>=300000))agent.privateConcern={text:d.privateConcern,since:clock,source:'subjective_model_concern'};
        if(d.intent==='silence')conversation.dialogue!.quietUntil=clock+10000;
      }
      if (args.leaveConversation||args.dialogue?.boundary?.scope==='contact') {
        conversation.leave(game, now, player);
      }
      return null;
    },
  }),
  createAgent: inputHandler({
    args: {
      descriptionIndex: v.number(),
    },
    handler: (game, now, args) => {
      const description = Descriptions[args.descriptionIndex];
      const playerId = Player.join(
        game,
        now,
        description.name,
        description.character,
        description.identity,
      );
      const agentId = game.allocId('agents');
      game.world.agents.set(
        agentId,
        new Agent({
          id: agentId,
          playerId: playerId,
          inProgressOperation: undefined,
          lastConversation: undefined,
          lastInviteAttempt: undefined,
          toRemember: undefined,
        }),
      );
      game.agentDescriptions.set(
        agentId,
        new AgentDescription({
          agentId: agentId,
          identity: description.identity,
          plan: description.plan,
        }),
      );
      return { agentId };
    },
  }),
};
