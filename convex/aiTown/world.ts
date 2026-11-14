import {worldClock,WorldClock} from './worldClock';
import {economyState,Economy} from './economyState';
import {villageState,Village} from './villageState';
import {livelihoodState,Livelihood} from './livelihoodState';
import {gardenState,Garden} from './gardenState';
import { ObjectType, v } from 'convex/values';
import { Conversation, serializedConversation } from './conversation';
import { Player, serializedPlayer } from './player';
import { Agent, serializedAgent } from './agent';
import { GameId, parseGameId, playerId } from './ids';
import { parseMap } from '../util/object';

export const historicalLocations = v.array(
  v.object({
    playerId,
    location: v.bytes(),
  }),
);

export const serializedWorld = {
  clock:v.optional(worldClock),
  livelihood:v.optional(livelihoodState),
  village:v.optional(villageState),
  economy:v.optional(economyState),
  garden:v.optional(gardenState),
  nextId: v.number(),
  conversations: v.array(v.object(serializedConversation)),
  players: v.array(v.object(serializedPlayer)),
  agents: v.array(v.object(serializedAgent)),
  historicalLocations: v.optional(historicalLocations),
};
export type SerializedWorld = ObjectType<typeof serializedWorld>;

export class World {
  clock?:WorldClock;
  livelihood?:Livelihood;
  village?:Village;
  economy?:Economy;
  garden?:Garden;
  nextId: number;
  conversations: Map<GameId<'conversations'>, Conversation>;
  players: Map<GameId<'players'>, Player>;
  agents: Map<GameId<'agents'>, Agent>;
  historicalLocations?: Map<GameId<'players'>, ArrayBuffer>;

  constructor(serialized: SerializedWorld) {
    const { nextId, historicalLocations } = serialized;

    this.nextId = nextId;
    this.clock=serialized.clock;
    this.garden=serialized.garden;
    this.village=serialized.village;
    this.livelihood=serialized.livelihood;
    for(const need of this.livelihood?.needs??[])need.restedness??=65;
    this.economy=serialized.economy;
    this.conversations = parseMap(serialized.conversations, Conversation, (c) => c.id);
    this.players = parseMap(serialized.players, Player, (p) => p.id);
    this.agents = parseMap(serialized.agents, Agent, (a) => a.id);

    if (historicalLocations) {
      this.historicalLocations = new Map();
      for (const { playerId, location } of historicalLocations) {
        this.historicalLocations.set(parseGameId('players', playerId), location);
      }
    }
  }

  playerConversation(player: Player): Conversation | undefined {
    return [...this.conversations.values()].find((c) => c.participants.has(player.id));
  }

  serialize(): SerializedWorld {
    return {
      clock:this.clock,
      livelihood:this.livelihood,
      village:this.village,
      economy:this.economy,
      garden:this.garden,
      nextId: this.nextId,
      conversations: [...this.conversations.values()].map((c) => c.serialize()),
      players: [...this.players.values()].map((p) => p.serialize()),
      agents: [...this.agents.values()].map((a) => a.serialize()),
      historicalLocations:
        this.historicalLocations &&
        [...this.historicalLocations.entries()].map(([playerId, location]) => ({
          playerId,
          location,
        })),
    };
  }
}
