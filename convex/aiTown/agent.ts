import {manualMove,ManualMove,tickManualMove} from './manualMovement';
import {spokenPlan,SpokenPlan,tickSpokenPlan} from './spokenPlan';
import {emergencyNeed} from './physicalPriority';
import {restedness} from '../../data/restedness';
import {releaseOffer} from './livelihoodState';
import {respondActivity} from './socialActivity';
import {sleepState,SleepState,sleepWork,REST_MAX_MS,REST_RECOVERED} from './sleepState';
import {lifeEvent} from './livelihoodState';
import {dialogueDecision} from './dialogueState';
import {tickSocialActivities,socialActivityWork} from './socialActivity';
import {behaviorBranch} from './behaviorTree';
import {socialProfiles} from '../../data/socialProfiles';
import {learningState,Learning,initialLearning,confirmStep,suspendPlan} from './learnedPlans';
import {awarenessState,Awareness,initialAwareness,canSee,updateMood} from './awareness';
import {residentDecision,ResidentDecision} from './actionChoice';
import {economyWork} from './economyRuntime';
import {workGarden} from './gardenState';
import {recordSpeech} from '../memoryGraph';
import {advanceVisit} from './villageState';
import {livelihoodWork} from './livelihoodRuntime';
import {foodCount} from './livelihoodState';
import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId } from './ids';
import { agentId, conversationId, playerId } from './ids';
import { serializedPlayer } from './player';
import { Game } from './game';
import {
  ACTION_TIMEOUT,
  AWKWARD_CONVERSATION_TIMEOUT,
  CONVERSATION_COOLDOWN,
  CONVERSATION_DISTANCE,
  INVITE_ACCEPT_PROBABILITY,
  INVITE_TIMEOUT,
  MAX_CONVERSATION_DURATION,
  MAX_CONVERSATION_MESSAGES,
  MESSAGE_COOLDOWN,
  MIDPOINT_THRESHOLD,
  PLAYER_CONVERSATION_COOLDOWN,
} from '../constants';
import { FunctionArgs } from 'convex/server';
import { MutationCtx, internalMutation, internalQuery } from '../_generated/server';
import { distance } from '../util/geometry';
import { internal } from '../_generated/api';
import { stopPlayer,movePlayer } from './movement';
import { insertInput } from './insertInput';

export class Agent {
  id: GameId<'agents'>;
  playerId: GameId<'players'>;
  toRemember?: GameId<'conversations'>;
  jointSessionId?:number;
  spokenPlan?:SpokenPlan;
  manualMove?:ManualMove;
  sleep?:SleepState;
  lastWakeClock?:number;
  restStartedClock?:number;
  privateConcern?:{text:string;since:number;source:string};
  learning?: Learning;
  awareness?: Awareness;
  suspendedDecision?: ResidentDecision;
  decision?: ResidentDecision;
  nextDecisionAt?: number;
  memoryOperation?: {operationId:string;started:number};
  memoryQueue: GameId<'conversations'>[];
  lastConversation?: number;
  lastInviteAttempt?: number;
  inProgressOperation?: {
    name: string;
    operationId: string;
    started: number;
  };

  constructor(serialized: SerializedAgent) {
    const { id, lastConversation, lastInviteAttempt, inProgressOperation } = serialized;
    const playerId = parseGameId('players', serialized.playerId);
    this.sleep=serialized.sleep;this.lastWakeClock=serialized.lastWakeClock;this.restStartedClock=serialized.restStartedClock;
    this.jointSessionId=serialized.jointSessionId;
    this.spokenPlan=serialized.spokenPlan;
    this.manualMove=serialized.manualMove;
    this.privateConcern=serialized.privateConcern;
    this.learning=serialized.learning;
    this.awareness=serialized.awareness;
    this.suspendedDecision=serialized.suspendedDecision;
    this.decision=serialized.decision;
    this.nextDecisionAt=serialized.nextDecisionAt;
    this.memoryOperation=serialized.memoryOperation;
    this.memoryQueue=(serialized.memoryQueue??[]).map(id=>parseGameId('conversations',id));
    this.id = parseGameId('agents', id);
    this.playerId = playerId;
    this.toRemember =
      serialized.toRemember !== undefined
        ? parseGameId('conversations', serialized.toRemember)
        : undefined;
    this.lastConversation = lastConversation;
    this.lastInviteAttempt = lastInviteAttempt;
    this.inProgressOperation = inProgressOperation;
  }

  tick(game: Game, now: number) {
    const player = game.world.players.get(this.playerId);
    if (!player) {
      throw new Error(`Invalid player ID ${this.playerId}`);
    }
    if(tickManualMove(game,this,now))return;
    if(tickSpokenPlan(game,this,now))return;
    // Migrate a summary already running when this code was deployed.
    if(this.inProgressOperation?.name==='agentRememberConversation'){
      this.memoryOperation={operationId:this.inProgressOperation.operationId,started:this.inProgressOperation.started};
      delete this.inProgressOperation;
    }
    if(this.toRemember){
      if(!this.memoryQueue.includes(this.toRemember))this.memoryQueue.push(this.toRemember);
      delete this.toRemember;
    }
    if(!this.memoryOperation&&this.memoryQueue.length){
      const operationId=game.allocId('operations');
      this.memoryOperation={operationId,started:now};
      game.scheduleOperation('agentRememberConversation',{worldId:game.worldId,playerId:this.playerId,agentId:this.id,conversationId:this.memoryQueue.shift()!,operationId});
    }
    const life=game.world.livelihood,econ=game.world.economy;
    let obligation=life?.offers.some(o=>['accepted','cooking'].includes(o.status)&&o.participants.includes(this.playerId));
    const needs=life?.needs.find(n=>n.owner===this.playerId);
    const needClock=life?.clock??now;
    if(needs&&restedness(needs)<=0&&!this.sleep&&life&&econ){
      for(const session of life.activities??[])if(['proposed','scheduled','gathering','active'].includes(session.status)&&session.participants.includes(this.playerId))respondActivity(game,session.id,this.playerId,'cancel',now,'Too sleep deprived to continue safely.');
      for(const offer of life.offers)if(['accepted','cooking'].includes(offer.status)&&offer.participants.includes(this.playerId))releaseOffer(life,econ,offer,now,'declined');
      const current=game.world.playerConversation(player);if(current)current.leave(game,now,player);
      if(this.decision?.kind!=='sleep'){
        if(this.inProgressOperation?.name==='agentGenerateMessage')delete this.inProgressOperation;delete this.decision;stopPlayer(player);econ.jobs=econ.jobs.filter(j=>j.owner!==this.playerId);life.jobs=life.jobs.filter(j=>j.owner!==this.playerId||j.kind==='eat');
        if(game.world.garden?.owner===this.playerId)delete game.world.garden.job;
        if(game.world.village)game.world.village.visits=game.world.village.visits.filter(v=>v.owner!==this.playerId);
        this.nextDecisionAt=now;
      }
    }
    obligation=life?.offers.some(o=>['accepted','cooking'].includes(o.status)&&o.participants.includes(this.playerId));
    const clock=game.world.clock?.elapsedMs??life?.clock??0;
    if(this.sleep){
      if(this.learning?.active&&this.learning.active.state!=='suspended')suspendPlan(this.learning,'Sleeping before reconsidering the plan');
      const state=this.sleep,current=game.world.playerConversation(player);
      if(current){const membership=current.participants.get(player.id);if(membership?.status.kind==='invited')current.rejectInvite(game,now,player);else current.leave(game,now,player);}
      const hungry=!!needs&&needs.hunger>=90;
      if(!hungry&&sleepWork(game,this.playerId,state,now)){
        const a=this.awareness??(this.awareness=initialAwareness(life?.clock??0));
        a.visible=[];a.branch=state.phase==='asleep'?'Sleeping at home':'Going home to sleep';
        a.lastClock=life?.clock??0;
        if(state.phase==='asleep'){
          if(a.trigger!=='Sleeping at home'&&life)lifeEvent(life,now,'sleep','Went to sleep at home.',[this.playerId]);
          a.trigger='Sleeping at home';a.lastCompanyClock=life?.clock??0;
        }
        return;
      }
      const slept=state.phase==='asleep';delete this.sleep;delete this.decision;delete this.suspendedDecision;delete player.activity;stopPlayer(player);
      if(slept)this.lastWakeClock=clock;
      this.nextDecisionAt=now;
      if(this.awareness)this.awareness.trigger=hungry?'Woke to find something to eat':slept?'Woke from sleep; choose what to do':'Could not reach home; choose another activity';
      if(life)lifeEvent(life,now,slept?'wake':'sleep_interrupted',hungry?'Interrupted sleep to find food.':slept?'Woke from sleep.':'Could not reach home to sleep.',[this.playerId]);
    }
    if(this.decision?.kind==='rest'&&needs&&needs.energy>=REST_RECOVERED){
      this.decision.until=now;this.nextDecisionAt=now;delete this.restStartedClock;delete player.activity;
    }
    if(this.privateConcern?.source==='need_sleep'&&needs&&restedness(needs)>=60)delete this.privateConcern;
    if(this.privateConcern?.source==='need_food'&&needs&&needs.hunger<35||this.privateConcern?.source==='need_rest'&&needs&&needs.energy>=55)delete this.privateConcern;
    if(!this.privateConcern&&needs&&(needs.hunger>=65||needs.energy<30||restedness(needs)<30))this.privateConcern={text:needs.hunger>=65?'I want to arrange something to eat before I get too hungry.':restedness(needs)<30?'I need proper sleep; a short break will not clear this sleep debt.':'I need a quieter spell before taking on more work.',source:needs.hunger>=65?'need_food':restedness(needs)<30?'need_sleep':'need_rest',since:needClock};
    const learning=this.learning??(this.learning=initialLearning());
    const action=this.decision?.actionId;
    if(action){
      const evidence=[...(life?.events??[]).filter(e=>e.witnesses.includes(this.playerId)).map(e=>({key:`life:${e.id}`,kind:e.kind,at:e.at})),
        ...(econ?.events??[]).filter(e=>e.witnesses.includes(this.playerId)&&!e.text.includes('did not catch')).map(e=>({key:`economy:${e.id}`,kind:e.kind,at:e.at})),
        ...(game.world.garden?.owner===this.playerId?game.world.garden.events:[]).map(e=>({key:`garden:${e.id}`,kind:e.kind,at:e.at}))];
      const kind=action.split(':')[0];
      const matches:Record<string,string[]>={fish:['fish'],garden:['plant','harvest'],eat:['eat'],cook:['cook'],forage:['forage'],'collect-food':['collect']};
      const completed=evidence.find(e=>!learning.evidence.includes(e.key)&&e.at>=(this.decision?.chosenAt??now)&&(matches[kind]??[]).includes(e.kind));
      if(completed)confirmStep(learning,action,completed.key);
    }
    const awareness=this.awareness??(this.awareness=initialAwareness(life?.clock??0));
    const hasCompany=!!game.world.playerConversation(player)||!!life?.activities?.some(s=>s.status==='active'&&s.participants.includes(this.playerId));
    updateMood(awareness,life?.clock??now,needs,life?.events??[],this.playerId,socialProfiles[game.playerDescriptions?.get(this.playerId)?.name??'']?.traits.sociability,hasCompany);
    if(!this.privateConcern&&life&&life.clock-(awareness.lastCompanyClock??life.clock)>=300000)this.privateConcern={text:'I would like some company on my own terms, if there is a good moment for it.',source:'company',since:life.clock};
    if(this.privateConcern?.source==='company'&&hasCompany&&life&&life.clock-this.privateConcern.since>=15000)delete this.privateConcern;
    awareness.branch=behaviorBranch({urgent:!!needs&&(needs.hunger>=90||needs.energy<15||restedness(needs)<=0),agreement:!!obligation,conversation:!!game.world.playerConversation(player),committed:!!this.decision&&now<this.decision.until});
    if(now>=awareness.nextScan){
      awareness.nextScan=now+500;
      const visible=[...game.world.players.values()].filter(p=>p.id!==player.id&&canSee(game.worldMap,player.position,p.position));
      const entered=visible.filter(p=>!awareness.visible.includes(p.id));
      awareness.visible=visible.map(p=>p.id);
      for(const p of visible){
        awareness.lastSeen=awareness.lastSeen.filter(s=>s.id!==p.id);
        awareness.lastSeen.push({id:p.id,position:{x:Math.round(p.position.x),y:Math.round(p.position.y)},at:now});
      }
      awareness.lastSeen=awareness.lastSeen.slice(-20);
      if(entered.length&&!obligation&&!econ?.jobs.some(j=>j.owner===this.playerId)&&!(game.world.garden?.owner===this.playerId&&game.world.garden.job)&&this.decision?.kind!=='rest'&&!this.inProgressOperation&&!game.world.playerConversation(player)&&now>=awareness.nextReaction&&now-(this.decision?.chosenAt??0)>=30000&&!(needs&&(needs.energy<30||needs.hunger>85))){
        awareness.nextReaction=now+60000;
        awareness.trigger=`Noticed ${entered.map(p=>game.playerDescriptions.get(p.id)?.name??'a resident').join(', ')} nearby`;
        // Preserve the active intention and its route while the model reconsiders.
        if(this.decision&&now<this.decision.until&&!this.suspendedDecision)this.suspendedDecision={...this.decision};
        this.startOperation(game,now,'agentChooseAction',{worldId:game.worldId,agentId:this.id});
      }
    }
    const emergency=emergencyNeed(needs)==='food'||emergencyNeed(needs)==='energy';
    if(emergency&&this.learning?.active){
      const next=this.learning.active.steps[this.learning.active.index];
      if(!(needs!.hunger>=90?next.startsWith('eat:'):next==='rest'))suspendPlan(this.learning,'Urgent physical recovery; reconsider afterward');
    }
    if(life&&econ&&(obligation||emergency)){
      const current=game.world.playerConversation(player);
      if(current&&(!current.casual||emergency))current.leave(game,now,player);
      if(!current?.casual||emergency)delete this.inProgressOperation;
      if(obligation&&!emergency){if(livelihoodWork(game,this.playerId,now)&&!current?.casual)return;}
      else if(!life.jobs.some(j=>j.owner===this.playerId)){
        const food=foodCount(econ,this.playerId,'meals')>0?'meals':foodCount(econ,this.playerId,'turnips')>0?'turnips':undefined;
        if(needs!.energy<15&&needs!.hunger<90){this.restStartedClock??=clock;stopPlayer(player);econ.jobs=econ.jobs.filter(j=>j.owner!==this.playerId);if(game.world.garden?.owner===this.playerId)delete game.world.garden.job;if(this.decision?.kind!=='rest')this.decision={kind:'rest',label:'Resting to recover',reason:'Too tired to keep working.',source:'fallback',chosenAt:now,until:now+45000};else this.decision.until=now+45000;this.nextDecisionAt=now+45000;}
        else if(food)life.jobs.push({owner:this.playerId,kind:'eat',item:food,requested:life.clock});
        else if(game.world.garden?.owner===this.playerId&&game.world.garden.food>0)life.jobs.push({owner:this.playerId,kind:'collect',requested:life.clock});
        else if(life.clock-needs!.lastForage>=180000)life.jobs.push({owner:this.playerId,kind:'forage',requested:life.clock});
      }
    }
    const passing=game.world.playerConversation(player)?.casual;
    if(passing){
      if(life?.jobs.some(j=>j.owner===this.playerId))livelihoodWork(game,this.playerId,now);
      else if(econ?.jobs.some(j=>j.owner===this.playerId))economyWork(game,this.playerId,now);
      else if(game.world.garden?.owner===this.playerId&&game.world.garden.job){
        const work=workGarden(game.world.garden,player.position,now);
        if(work?.destination&&!player.pathfinding)movePlayer(game,now,player,work.destination);
        if(work?.label==='Finished garden work'&&life&&game.world.garden.events.at(-1)?.kind==='harvest')life.produced.turnips+=2;
      }
    }
    if(!emergency&&!obligation){
      const joint=socialActivityWork(game,this.playerId,now);
      if(joint){
        if(this.jointSessionId!==joint.id){
          this.jointSessionId=joint.id;if(this.inProgressOperation?.name==='agentChooseAction')delete this.inProgressOperation;
          if(this.decision&&!this.suspendedDecision)this.suspendedDecision={...this.decision};
          if(econ)econ.jobs=econ.jobs.filter(j=>j.owner!==this.playerId);
          if(life)life.jobs=life.jobs.filter(j=>j.owner!==this.playerId);
          if(game.world.garden?.owner===this.playerId)delete game.world.garden.job;
          this.decision={kind:'joint',label:'Joining an agreed '+joint.activity,reason:'Following through on invitation #'+joint.id,source:'model',chosenAt:now,until:now+180000};
          this.nextDecisionAt=now+30000;
        }
        const current=game.world.playerConversation(player);
        if(joint.moving&&current&&!current.casual)current.leave(game,now,player);
        if(!current){
          if(!this.inProgressOperation&&now>=(this.nextDecisionAt??0))this.startOperation(game,now,'agentChooseAction',{worldId:game.worldId,agentId:this.id});
          return;
        }
      }else if(this.jointSessionId!==undefined){delete this.jointSessionId;if(!game.world.playerConversation(player)&&this.suspendedDecision){this.decision={...this.suspendedDecision,until:now};delete this.suspendedDecision;awareness.trigger='Shared activity finished; reconsider the earlier intention';}else if(this.decision)this.decision.until=now;this.nextDecisionAt=now;}
    }
    if(this.inProgressOperation?.name==='agentGenerateMessage'&&!game.world.playerConversation(player))delete this.inProgressOperation;
    if(this.inProgressOperation){
      if(now>=this.inProgressOperation.started+(this.inProgressOperation.name==='agentChooseAction'?20000:ACTION_TIMEOUT))delete this.inProgressOperation;
      else if(this.inProgressOperation.name!=='agentRememberConversation')return;
    }
    const conversation=game.world.playerConversation(player),member=conversation?.participants.get(player.id);
    if(!conversation&&!this.inProgressOperation&&this.suspendedDecision&&this.lastConversation&&now-this.lastConversation<30000){
        const prior=this.suspendedDecision;delete this.suspendedDecision;
        if(!['talk','visit','continue'].includes(prior.kind)){
          this.decision={...prior,chosenAt:now,until:now+90000};this.nextDecisionAt=now;
          awareness.trigger=`Conversation finished; consider resuming ${prior.label}`;
        }
      }
    const garden=game.world.garden,economy=game.world.economy,decision=this.decision;
    const working=decision&&now<decision.until&&['fish','trade','deposit','garden','market','place','eat','cook','collect','forage'].includes(decision.kind);
    if(working&&!['place','market'].includes(decision.kind)&&conversation&&!conversation.casual&&member?.status.kind==='invited'){
      conversation.rejectInvite(game,now,player);return;
    }
    if(!conversation){
      if(life?.jobs.some(j=>j.owner===this.playerId)){
        livelihoodWork(game,this.playerId,now);
        if(!life.jobs.some(j=>j.owner===this.playerId)&&decision)decision.until=now;
        return;
      }
      if(decision&&now>=decision.until){
        if(economy)economy.jobs=economy.jobs.filter(j=>j.owner!==this.playerId);
        if(garden?.owner===this.playerId)delete garden.job;
        if(game.world.village)game.world.village.visits=game.world.village.visits.filter(v=>v.owner!==this.playerId);
      }
      if(working&&decision.kind==='place'&&game.world.village){
        const visit=advanceVisit(game.world.village,this.playerId,player.position,now,garden?.time??now);
        if(visit){
          if(visit.destination){if(!player.pathfinding)movePlayer(game,now,player,visit.destination);}
          else player.activity={description:visit.label,until:now+1000};
          if(visit.finished){if(decision.actionId)confirmStep(learning,decision.actionId,`visit:${decision.chosenAt}`);decision.until=now;}
          return;
        }
        decision.until=now;
      }
      if(economy?.jobs.some(j=>j.owner===this.playerId)){
        economyWork(game,this.playerId,now);
        if(!economy.jobs.some(j=>j.owner===this.playerId)&&decision)decision.until=now;
        return;
      }
      if(working&&decision.kind==='garden'&&garden?.owner===this.playerId){
        const work=workGarden(garden,player.position,now);
        if(work){
          if(work.destination){if(!player.pathfinding)movePlayer(game,now,player,work.destination);}
          else player.activity={description:work.label,until:now+1000};
          if(work.label==='Finished garden work'){
            decision.until=now;
            if(life&&garden.events.at(-1)?.kind==='harvest')life.produced.turnips+=2;
          }
          return;
        }
        decision.until=now;
      }
      if(working&&decision.kind==='market'){
        economyWork(game,this.playerId,now);
        if(!player.pathfinding)player.activity={description:'Tending the market stall',until:decision.until};
        return;
      }
      if(decision?.kind==='rest'&&needs){
        this.restStartedClock??=clock;
        const recovered=needs.energy>=REST_RECOVERED,timedOut=clock-this.restStartedClock>=REST_MAX_MS;
        if(recovered||timedOut){
          if(decision.actionId)confirmStep(learning,decision.actionId,`rest:${decision.chosenAt}`);
          decision.until=now;this.nextDecisionAt=now;delete this.restStartedClock;delete player.activity;
          awareness.trigger=recovered?'Recovered enough; choose an activity':'Short rest finished; reconsider what is needed';
        }else{
          decision.until=now+1000;this.nextDecisionAt=decision.until;
          player.activity={description:'Resting to recover',until:decision.until};return;
        }
      }
      if(decision&&now<decision.until&&['rest','wander','visit','walk'].includes(decision.kind)){
        if(player.pathfinding)return;
        if(['visit','walk','wander'].includes(decision.kind)&&now-decision.chosenAt>1500){
          const arrived=!decision.destination||Math.hypot(player.position.x-decision.destination.x,player.position.y-decision.destination.y)<1.6;
          awareness.trigger=!arrived?'The route could not be completed; choose another approach':decision.kind==='visit'?'Reached the last known location; look around. The resident may have moved.':'Finished walking; choose what to do here';
          if(arrived&&decision.actionId)confirmStep(learning,decision.actionId,`arrival:${decision.chosenAt}`);
          decision.until=now;this.nextDecisionAt=now;
        }
        if(now<(this.nextDecisionAt??0)){
          player.activity={description:decision.kind==='rest'?'Resting a while':decision.kind==='visit'?'Spending a moment near a neighbor':'Taking in the village',until:this.nextDecisionAt!};
          return;
        }
        decision.until=now;
      }
    }
    if(this.inProgressOperation)return;
    if(!conversation){
      // A delegated sequence owns the next choice until its result is observed.
      if(this.spokenPlan&&!['done','interrupted'].includes(this.spokenPlan.state))return;
      if(now<(this.nextDecisionAt??0))return;
      this.startOperation(game,now,'agentChooseAction',{worldId:game.worldId,agentId:this.id});
      return;
    }
    if (conversation && member) {
      const [otherPlayerId, otherMember] = [...conversation.participants.entries()].find(
        ([id]) => id !== player.id,
      )!;
      const otherPlayer = game.world.players.get(otherPlayerId)!;
      if (member.status.kind === 'invited') {
        // Accept a conversation with another agent with some probability and with
        // a human unconditionally.
        if (otherPlayer.human || Math.random() < INVITE_ACCEPT_PROBABILITY) {
          console.log(`Agent ${player.id} accepting invite from ${otherPlayer.id}`);
          conversation.acceptInvite(game, player);
          // Stop moving so we can start walking towards the other player.
          if (player.pathfinding&&!conversation.casual) {
            delete player.pathfinding;
          }
        } else {
          console.log(`Agent ${player.id} rejecting invite from ${otherPlayer.id}`);
          conversation.rejectInvite(game, now, player);
        }
        return;
      }
      if (member.status.kind === 'walkingOver') {
        if(conversation.casual)return;
        // Leave a conversation if we've been waiting for too long.
        if (member.invited + INVITE_TIMEOUT < now) {
          console.log(`Giving up on invite to ${otherPlayer.id}`);
          conversation.leave(game, now, player);
          return;
        }

        // Don't keep moving around if we're near enough.
        const playerDistance = distance(player.position, otherPlayer.position);
        if (playerDistance < CONVERSATION_DISTANCE) {
          return;
        }

        // Keep moving towards the other player.
        // If we're close enough to the player, just walk to them directly.
        if (!player.pathfinding) {
          let destination;
          if (playerDistance < MIDPOINT_THRESHOLD) {
            destination = {
              x: Math.floor(otherPlayer.position.x),
              y: Math.floor(otherPlayer.position.y),
            };
          } else {
            destination = {
              x: Math.floor((player.position.x + otherPlayer.position.x) / 2),
              y: Math.floor((player.position.y + otherPlayer.position.y) / 2),
            };
          }
          console.log(`Agent ${player.id} walking towards ${otherPlayer.id}...`, destination);
          movePlayer(game, now, player, destination);
        }
        return;
      }
      if (member.status.kind === 'participating') {
        if((conversation.dialogue?.quietUntil??0)>(life?.clock??now))return;
        const started = member.status.started;
        if (conversation.isTyping && conversation.isTyping.playerId !== player.id) {
          // Wait for the other player to finish typing.
          return;
        }
        if (!conversation.lastMessage) {
          const isInitiator = conversation.creator === player.id;
          const awkwardDeadline = started + AWKWARD_CONVERSATION_TIMEOUT;
          // Send the first message if we're the initiator or if we've been waiting for too long.
          if (isInitiator || awkwardDeadline < now) {
            // Grab the lock on the conversation and send a "start" message.
            console.log(`${player.id} initiating conversation with ${otherPlayer.id}.`);
            const messageUuid = crypto.randomUUID();
            conversation.setIsTyping(now, player, messageUuid);
            this.startOperation(game, now, 'agentGenerateMessage', {
              worldId: game.worldId,
              playerId: player.id,
              agentId: this.id,
              conversationId: conversation.id,
              otherPlayerId: otherPlayer.id,
              messageUuid,
              type: 'start',
            });
            return;
          } else {
            // Wait on the other player to say something up to the awkward deadline.
            return;
          }
        }
        // See if the conversation has been going on too long and decide to leave.
        const tooLongDeadline = started + MAX_CONVERSATION_DURATION;
        if (tooLongDeadline < now || conversation.numMessages > MAX_CONVERSATION_MESSAGES) {
          console.log(`${player.id} leaving conversation with ${otherPlayer.id}.`);
          const messageUuid = crypto.randomUUID();
          conversation.setIsTyping(now, player, messageUuid);
          this.startOperation(game, now, 'agentGenerateMessage', {
            worldId: game.worldId,
            playerId: player.id,
            agentId: this.id,
            conversationId: conversation.id,
            otherPlayerId: otherPlayer.id,
            messageUuid,
            type: 'leave',
          });
          return;
        }
        // Wait for the awkward deadline if we sent the last message.
        if (conversation.lastMessage.author === player.id) {
          const awkwardDeadline = conversation.lastMessage.timestamp + AWKWARD_CONVERSATION_TIMEOUT;
          if (now < awkwardDeadline) {
            return;
          }
        }
        // Wait for a cooldown after the last message to simulate "reading" the message.
        const messageCooldown = conversation.lastMessage.timestamp + MESSAGE_COOLDOWN;
        if (now < messageCooldown) {
          return;
        }
        // Grab the lock and send a message!
        console.log(`${player.id} continuing conversation with ${otherPlayer.id}.`);
        const messageUuid = crypto.randomUUID();
        conversation.setIsTyping(now, player, messageUuid);
        this.startOperation(game, now, 'agentGenerateMessage', {
          worldId: game.worldId,
          playerId: player.id,
          agentId: this.id,
          conversationId: conversation.id,
          otherPlayerId: otherPlayer.id,
          messageUuid,
          type: 'continue',
        });
        return;
      }
    }
  }

  startOperation<Name extends keyof AgentOperations>(
    game: Game,
    now: number,
    name: Name,
    args: Omit<FunctionArgs<AgentOperations[Name]>, 'operationId'>,
  ) {
    if (this.inProgressOperation) {
      throw new Error(
        `Agent ${this.id} already has an operation: ${JSON.stringify(this.inProgressOperation)}`,
      );
    }
    const operationId = game.allocId('operations');
    console.log(`Agent ${this.id} starting operation ${name} (${operationId})`);
    game.scheduleOperation(name, { operationId, ...args } as any);
    this.inProgressOperation = {
      name,
      operationId,
      started: now,
    };
  }

  serialize(): SerializedAgent {
    return {
      id: this.id,
      playerId: this.playerId,
      toRemember: this.toRemember,
      lastConversation: this.lastConversation,
      lastInviteAttempt: this.lastInviteAttempt,
      inProgressOperation: this.inProgressOperation,
      sleep:this.sleep,lastWakeClock:this.lastWakeClock,restStartedClock:this.restStartedClock,
      jointSessionId:this.jointSessionId,
      spokenPlan:this.spokenPlan,
      manualMove:this.manualMove,
      privateConcern:this.privateConcern,
      learning:this.learning,
      awareness:this.awareness,
      suspendedDecision:this.suspendedDecision,
      decision:this.decision,
      nextDecisionAt:this.nextDecisionAt,
      memoryOperation:this.memoryOperation,
      memoryQueue:this.memoryQueue,
    };
  }
}

export const serializedAgent = {
  id: agentId,
  playerId: playerId,
  toRemember: v.optional(conversationId),
  sleep:v.optional(sleepState),lastWakeClock:v.optional(v.number()),restStartedClock:v.optional(v.number()),
  jointSessionId:v.optional(v.number()),
  spokenPlan:v.optional(spokenPlan),
  manualMove:v.optional(manualMove),
  privateConcern:v.optional(v.object({text:v.string(),since:v.number(),source:v.string()})),
  learning:v.optional(learningState),
  awareness:v.optional(awarenessState),
  suspendedDecision:v.optional(residentDecision),
  decision:v.optional(residentDecision),
  nextDecisionAt:v.optional(v.number()),
  memoryOperation:v.optional(v.object({operationId:v.string(),started:v.number()})),
  memoryQueue:v.optional(v.array(conversationId)),
  lastConversation: v.optional(v.number()),
  lastInviteAttempt: v.optional(v.number()),
  inProgressOperation: v.optional(
    v.object({
      name: v.string(),
      operationId: v.string(),
      started: v.number(),
    }),
  ),
};
export type SerializedAgent = ObjectType<typeof serializedAgent>;

type AgentOperations = typeof internal.aiTown.agentOperations & {agentChooseAction:typeof internal.residentActions.choose};

export async function runAgentOperation(ctx: MutationCtx, operation: string, args: any) {
  let reference;
  switch (operation) {
    case 'agentRememberConversation':
      reference = internal.aiTown.agentOperations.agentRememberConversation;
      break;
    case 'agentGenerateMessage':
      reference = internal.aiTown.agentOperations.agentGenerateMessage;
      break;
    case 'agentChooseAction':
      reference = internal.residentActions.choose;
      break;
    case 'agentDoSomething':
      reference = internal.aiTown.agentOperations.agentDoSomething;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
  await ctx.scheduler.runAfter(0, reference, args);
}

export const agentSendMessage = internalMutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    agentId,
    playerId,
    text: v.string(),
    messageUuid: v.string(),
    leaveConversation: v.boolean(),
    dialogue:v.optional(dialogueDecision),
    guardReason:v.optional(v.string()),
    repairReason:v.optional(v.string()),
    actionError:v.optional(v.string()),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const world=await ctx.db.get(args.worldId);
    if(!world?.conversations.some(c=>c.id===args.conversationId&&c.participants.some(p=>p.playerId===args.playerId))||!world.agents.some(a=>a.id===args.agentId&&a.inProgressOperation?.operationId===args.operationId))return;
    if(await ctx.db.query('dialogueTurns').withIndex('operation',q=>q.eq('worldId',args.worldId).eq('operationId',args.operationId)).unique())return;
    const active=world.conversations.find(c=>c.id===args.conversationId)!;
    const partner=active.participants.find(p=>p.playerId!==args.playerId)?.playerId??'';
    await ctx.db.insert('dialogueTurns',{worldId:args.worldId,operationId:args.operationId,conversationId:args.conversationId,speaker:args.playerId,partner,intent:args.dialogue?.intent??'unknown',status:args.guardReason?'blocked':args.text.trim()?'spoken':'silent',...(args.guardReason?{reason:args.guardReason}:{}),...(args.repairReason?{repairReason:args.repairReason}:{}),ended:args.leaveConversation,at:Date.now()});
    if(args.guardReason){await insertInput(ctx,args.worldId,'failedDialogue',{agentId:args.agentId,operationId:args.operationId,reason:args.guardReason});return;}
    if(args.text.trim()){
    const messageId=await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      text: args.text,
      messageUuid: args.messageUuid,
      worldId: args.worldId,
    });
    const conversation=world.conversations.find(c=>c.id===args.conversationId);
    const description=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',args.worldId).eq('playerId',args.playerId)).first();
    await recordSpeech(ctx,{worldId:args.worldId,source:`town:${messageId}`,context:'Town conversation',speaker:args.playerId,speakerName:description?.name??args.playerId,text:args.text,witnesses:conversation?.participants.filter(p=>p.status.kind==='participating').map(p=>p.playerId)??[],occurredAt:Date.now()});
    }
    await insertInput(ctx, args.worldId, 'agentFinishSendingMessage', {
      conversationId: args.conversationId,
      agentId: args.agentId,
      timestamp: Date.now(),
      leaveConversation: args.leaveConversation,
      ...(args.dialogue?{dialogue:args.dialogue}:{}),
      ...(args.actionError?{actionError:args.actionError}:{}),
      operationId: args.operationId,
    });
  },
});

export const findConversationCandidate = internalQuery({
  args: {
    now: v.number(),
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
  },
  handler: async (ctx, { now, worldId, player, otherFreePlayers }) => {
    const { position } = player;
    const candidates = [];

    for (const otherPlayer of otherFreePlayers) {
      // Find the latest conversation we're both members of.
      const lastMember = await ctx.db
        .query('participatedTogether')
        .withIndex('edge', (q) =>
          q.eq('worldId', worldId).eq('player1', player.id).eq('player2', otherPlayer.id),
        )
        .order('desc')
        .first();
      if (lastMember) {
        if (now < lastMember.ended + PLAYER_CONVERSATION_COOLDOWN) {
          continue;
        }
      }
      candidates.push({ id: otherPlayer.id, position });
    }

    // Sort by distance and take the nearest candidate.
    candidates.sort((a, b) => distance(a.position, position) - distance(b.position, position));
    return candidates[0]?.id;
  },
});
