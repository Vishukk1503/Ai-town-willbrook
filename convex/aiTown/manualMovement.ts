import { v, Infer } from 'convex/values';
import type { Game } from './game';
import type { Agent } from './agent';
import { playerId, parseGameId } from './ids';
import { point } from '../util/types';
import { inputHandler } from './inputHandler';
import { blocked, findRoute, movePlayer, stopPlayer } from './movement';
import { interruptSpokenPlan } from './spokenPlan';
import { suspendPlan } from './learnedPlans';
import { lifeEvent } from './livelihoodState';

export const manualMove = v.object({destination: point, deadline: v.number()});
export type ManualMove = Infer<typeof manualMove>;

function finish(game: Game, agent: Agent, now: number, message: string) {
  const player=game.world.players.get(agent.playerId)!;
  stopPlayer(player);
  delete agent.manualMove;
  player.activity={description:message,until:now+2000};
  agent.nextDecisionAt=now+2000;
  if(game.world.livelihood)lifeEvent(game.world.livelihood,now,'directed_walk',message,[agent.playerId]);
}

export function tickManualMove(game: Game, agent: Agent, now: number): boolean {
  const command=agent.manualMove;
  if(!command)return false;
  const player=game.world.players.get(agent.playerId)!;
  if(Math.hypot(player.position.x-command.destination.x,player.position.y-command.destination.y)<0.05){
    finish(game,agent,now,'Reached the spot you selected');
  }else if((game.world.clock?.elapsedMs??now)>=command.deadline||!player.pathfinding){
    finish(game,agent,now,'Could not finish the directed walk; returning to village life');
  }else{
    player.activity={description:'Walking to the spot you selected',until:now+1500};
  }
  return true;
}

export const manualMovementInputs = {
  moveResidentTo: inputHandler({
    args:{playerId,destination:v.union(point,v.null())},
    handler:(game,now,args)=>{
      const id=parseGameId('players',args.playerId),player=game.world.players.get(id);
      const agent=[...game.world.agents.values()].find(a=>a.playerId===id);
      if(!player||!agent)throw Error('Select a town resident first.');
      if(args.destination===null){
        if(agent.manualMove)finish(game,agent,now,'Directed walk stopped');
        return null;
      }
      const destination=args.destination;
      if(!Number.isInteger(destination.x)||!Number.isInteger(destination.y))throw Error('Choose a map tile.');
      if(blocked(game,now,destination,id))throw Error('That spot is blocked. Choose open ground.');
      if(Math.hypot(player.position.x-destination.x,player.position.y-destination.y)<0.05)return null;
      const route=findRoute(game,now,player,destination);
      if(!route||route.newDestination)throw Error('No path to that spot. Choose reachable ground.');
      const life=game.world.livelihood;
      if(life?.offers.some(o=>['accepted','cooking'].includes(o.status)&&o.participants.includes(id))||
         life?.activities?.some(a=>['scheduled','gathering','active'].includes(a.status)&&a.participants.includes(id)))
        throw Error('This resident is taking part in an agreed activity. Let it finish before directing a walk.');
      // Validate before interrupting anything. Late model replies then fail their operation ID check.
      const conversation=game.world.playerConversation(player);
      if(conversation)conversation.leave(game,now,player);
      interruptSpokenPlan(game,agent,now,'You directed the resident to another location');
      delete agent.inProgressOperation;
      if(agent.learning)suspendPlan(agent.learning,'You directed a walk; reconsider afterward');
      if(agent.sleep){
        delete agent.sleep;
        agent.lastWakeClock=game.world.clock?.elapsedMs??0;
        if(life)lifeEvent(life,now,'wake','Woke because you directed a walk.',[id]);
      }
      delete agent.decision;delete agent.suspendedDecision;delete agent.restStartedClock;
      if(game.world.garden?.owner===id)delete game.world.garden.job;
      if(game.world.economy)game.world.economy.jobs=game.world.economy.jobs.filter(j=>j.owner!==id);
      if(life)life.jobs=life.jobs.filter(j=>j.owner!==id);
      if(game.world.village)game.world.village.visits=game.world.village.visits.filter(j=>j.owner!==id);
      agent.manualMove={destination,deadline:(game.world.clock?.elapsedMs??now)+120000};
      movePlayer(game,now,player,destination);
      player.activity={description:'Walking to the spot you selected',until:now+1500};
      if(life)lifeEvent(life,now,'directed_walk',`You directed a walk to (${destination.x}, ${destination.y}).`,[id]);
      return null;
    },
  }),
};
