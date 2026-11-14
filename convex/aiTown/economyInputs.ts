import {v} from 'convex/values';
import {inputHandler} from './inputHandler';
import {playerId,parseGameId} from './ids';
import {transfer,near} from './economyState';
export const economyInputs={giveItem:inputHandler({args:{from:playerId,to:playerId,item:v.union(v.literal('turnips'),v.literal('seeds'),v.literal('fish'),v.literal('rod'),v.literal('meals')),quantity:v.number()},handler:(game,now,args)=>{
  const e=game.world.economy,a=game.world.players.get(parseGameId('players',args.from)),b=game.world.players.get(parseGameId('players',args.to));
  if(!e||!a||!b||!near(a.position,b.position))return {error:'Residents must be nearby to give an item.'};
  if(!transfer(e.bags,args.from,args.to,args.item,args.quantity))return {error:'Invalid quantity or insufficient owned items.'};
  e.events.push({id:e.nextEvent++,kind:'give',at:now,witnesses:[args.from,args.to],text:`${game.playerDescriptions.get(parseGameId('players',args.from))?.name} gave ${args.quantity} ${args.item} to ${game.playerDescriptions.get(parseGameId('players',args.to))?.name}.`});e.events=e.events.slice(-30);
  return {given:true};
}})};
