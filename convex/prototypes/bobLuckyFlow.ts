import { Game } from '../aiTown/game';
import { Conversation, conversationInputs } from '../aiTown/conversation';
import { initialAwareness } from '../aiTown/awareness';
import { livelihood } from '../aiTown/livelihoodState';
import { emptyItems } from '../aiTown/economyState';
import { proposeActivity, respondActivity } from '../aiTown/socialActivity';
import { rememberBoundary } from '../aiTown/socialBoundary';
import { movePlayer, findRoute, stopPlayer } from '../aiTown/movement';
import { parseGameId } from '../aiTown/ids';
import { emergencyNeed } from '../aiTown/physicalPriority';
import { WORLD_HOUR_MS, worldTime } from '../../data/worldTime';

export type Intent =
  | 'invite_walk'
  | 'leave_for_garden'
  | 'home_then_quiet_hour'
  | 'quiet_hour_then_home'
  | 'ack_garden'
  | 'ack_home';
type Name = 'Bob' | 'Lucky';
type Point = { x: number; y: number };
export type Ticket = { revision: number; actor: Name; intent: Intent; id: string };
const ids = { Bob: parseGameId('players', 'p:2'), Lucky: parseGameId('players', 'p:0') };
const destinations = {
  garden: { x: 7, y: 7 },
  bobHome: { x: 2, y: 6 },
  luckyHome: { x: 10, y: 6 },
};
export const effects: Record<Intent, string> = {
  invite_walk:
    'Invite Lucky to walk from the garden to the river now. This is an offer, not consent or movement. Do not say either person has agreed.',
  leave_for_garden:
    'End this encounter and walk to the garden edge. No gardening work or timed stay has been selected.',
  home_then_quiet_hour:
    "Decline Bob's walk. After one acknowledgment, walk home immediately, THEN stay alone there for one full village hour starting at arrival. Do not say you will wait here first.",
  quiet_hour_then_home:
    "Decline Bob's walk. After one acknowledgment, stay HERE alone for one full village hour, THEN walk home. Do not say you are going home immediately.",
  ack_garden:
    "Acknowledge Lucky's refusal and solitude, end the encounter, and walk to the garden edge. No invitation, task, food, wait-until-sunset or completed movement.",
  ack_home:
    "Acknowledge Lucky's refusal and solitude, end the encounter, and walk to your home entrance. No invitation, sleep, task or completed movement.",
};

// Deliberately isolated vertical slice, not connected to town scheduling.
// Speech is never parsed into control: this controller commits the chosen intent.
export class BobLuckyFlow {
  game: Game;
  revision = 0;
  phase: 'opening' | 'offered' | 'closing' | 'closed' = 'opening';
  now = 100000;
  invitationId?: number;
  luckySequence?: {
    choice: 'home_then_quiet_hour' | 'quiet_hour_then_home';
    state: 'pending' | 'walking' | 'waiting' | 'done';
    waitUntil?: number;
    waitSamples: { at: number; position: Point }[];
  };
  conversationId: ReturnType<typeof Conversation.start>['conversationId'];
  transcript: { actor: Name; speech: string; decisionId: string }[] = [];
  events: { kind: string; actor: string; detail: string; at: number }[] = [];
  paths: {
    actor: Name;
    destination: Point;
    positions: Point[];
    arrived: boolean;
    elapsedMs: number;
    startedAt: number;
    firstMovedAt?: number;
  }[] = [];
  constructor() {
    const clock = 2 * WORLD_HOUR_MS,
      owners = [ids.Bob, ids.Lucky],
      life = livelihood(owners, clock);
    for (const n of life.needs) {
      n.hunger = 20;
      n.energy = 90;
      n.restedness = 90;
    }
    this.game = new Game(
      {} as any,
      'isolated-prototype' as any,
      {
        world: {
          nextId: 100,
          clock: { elapsedMs: clock },
          players: owners.map((id, i) => ({
            id,
            position: { x: 4 + i, y: 4 },
            facing: { dx: 1, dy: 0 },
            speed: 0,
            lastInput: this.now,
          })),
          agents: owners.map((playerId, i) => ({
            id: 'a:' + i,
            playerId,
            awareness: {
              ...initialAwareness(clock),
              socialReadiness: 70,
              lastCompanyClock: clock - 4 * WORLD_HOUR_MS,
            },
          })),
          conversations: [],
          livelihood: life,
          garden: {
            owner: ids.Bob,
            home: { x: 2, y: 6 },
            origin: { x: 1, y: 1 },
            time: 0,
            seeds: 0,
            food: 0,
            nextJob: 0,
            beds: [],
            events: [],
            nextEvent: 0,
          },
          economy: {
            merchant: 'p:4',
            fisher: ids.Lucky,
            market: { x: 12, y: 10 },
            bank: { x: 15, y: 4 },
            water: { x: 16, y: 4 },
            bags: owners.map((owner) => ({ owner, items: { ...emptyItems(), meals: 2 } })),
            marketStock: emptyItems(),
            population: 3,
            lastRecovery: 0,
            rng: 12345,
            jobs: [],
            nextFish: 0,
            events: [],
            nextEvent: 0,
          },
          village: {
            places: owners.map((owner, i) => ({
              id: 'home-' + i,
              name: (i ? 'Lucky' : 'Bob') + ' home',
              kind: 'home',
              owner,
              entrance: i ? destinations.luckyHome : destinations.bobHome,
              footprint: { x: i ? 10 : 2, y: 7, w: 2, h: 2 },
              description: 'Home entrance',
            })),
            paths: [],
            visits: [],
            events: [],
            nextEvent: 0,
          },
        },
        worldMap: {
          width: 20,
          height: 20,
          objectTiles: [],
          bgTiles: [],
          tileSetUrl: '',
          tileSetDimX: 1,
          tileSetDimY: 1,
          tileDim: 16,
          animatedSprites: [],
        },
        playerDescriptions: owners.map((playerId, i) => ({
          playerId,
          name: i ? 'Lucky' : 'Bob',
          description: 'Resident',
          character: 'f1',
        })),
        agentDescriptions: [],
      } as any,
    );
    const { conversationId, error } = Conversation.start(
      this.game,
      this.now,
      this.player('Bob'),
      this.player('Lucky'),
    );
    if (error || !conversationId) throw new Error(error ?? 'Conversation not created');
    this.conversationId = conversationId;
    const c = this.game.world.conversations.get(conversationId)!;
    c.acceptInvite(this.game, this.player('Lucky'));
    c.tick(this.game, this.now);
    // The fixture starts face-to-face; discard the conversation's optional shuffle.
    for (const p of this.game.world.players.values()) stopPlayer(p);
  }
  player(name: Name) {
    return this.game.world.players.get(ids[name])!;
  }
  agent(name: Name) {
    return [...this.game.world.agents.values()].find((a) => a.playerId === ids[name])!;
  }
  actor(): Name {
    return this.phase === 'offered' ? 'Lucky' : 'Bob';
  }
  menu(): Intent[] {
    return this.phase === 'opening'
      ? ['invite_walk', 'leave_for_garden']
      : this.phase === 'offered'
        ? ['home_then_quiet_hour', 'quiet_hour_then_home']
        : this.phase === 'closing'
          ? ['ack_garden', 'ack_home']
          : [];
  }
  observe() {
    return {
      phase: this.phase,
      revision: this.revision,
      actor: this.actor(),
      villageTime: worldTime(this.game.world.clock!.elapsedMs),
      needs: this.game.world.livelihood!.needs.find((n) => n.owner === ids[this.actor()]),
      invitation:
        this.game.world.livelihood!.activities?.find((s) => s.id === this.invitationId) ?? null,
      transcript: this.transcript,
      currentState: this.actor() === 'Bob' && this.luckySequence ? {
        source: 'Committed engine state; takes precedence over earlier suggestions in the transcript',
        walkInvitationStatus: this.game.world.livelihood!.activities?.find(s => s.id === this.invitationId)?.status,
        luckyCommittedPlan: {
          choice: this.luckySequence.choice,
          state: this.luckySequence.state,
          destination: 'Lucky’s own home entrance',
          steps: this.luckySequence.choice === 'home_then_quiet_hour'
            ? ['Walk home after this acknowledgment', 'Stay alone at home for one village hour after arrival']
            : ['Stay here alone for one village hour after this acknowledgment', 'Then walk home'],
        },
        bobNextActions: this.menu(),
      } : null,
      boundaries: this.agent(this.actor()).awareness?.boundaries ?? [],
      options: this.menu().map((id) => ({ id, effect: effects[id] })),
    };
  }
  prepare(actor: Name, intent: Intent): Ticket {
    const t = {
      revision: this.revision,
      actor,
      intent,
      id: `turn-${this.revision}:${actor}:${intent}`,
    };
    this.validate(t);
    return t;
  }
  validate(t: Ticket) {
    if (t.revision !== this.revision || t.actor !== this.actor() || !this.menu().includes(t.intent))
      throw new Error('Stale or unavailable intention');
    if (!this.game.world.conversations.has(this.conversationId!))
      throw new Error('Encounter ended before commit');
    if (this.game.world.livelihood!.needs.some((n) => emergencyNeed(n)))
      throw new Error('Physical emergency superseded this encounter');
    if (['offered', 'closing'].includes(this.phase)) {
      const invite = this.game.world.livelihood!.activities?.find(
        (s) => s.id === this.invitationId,
      );
      if (
        !invite ||
        invite.status !== (this.phase === 'offered' ? 'proposed' : 'declined') ||
        (this.phase === 'offered' && invite.expires <= this.game.world.livelihood!.clock)
      )
        throw new Error('Invitation changed or expired');
    }
    if (t.intent === 'invite_walk') {
      if (
        this.game.world.livelihood!.activities?.some((s) =>
          ['proposed', 'scheduled', 'gathering', 'active'].includes(s.status),
        )
      )
        throw new Error('Another invitation is pending');
    }
    const routes =
      t.intent === 'ack_garden'
        ? [
            [this.player('Bob'), destinations.garden],
            [this.player('Lucky'), destinations.luckyHome],
          ]
        : t.intent === 'ack_home'
          ? [
              [this.player('Bob'), destinations.bobHome],
              [this.player('Lucky'), destinations.luckyHome],
            ]
          : t.intent === 'leave_for_garden'
            ? [[this.player('Bob'), destinations.garden]]
            : [];
    for (const [p, destination] of routes) {
      const route = findRoute(
        this.game,
        this.now,
        p as ReturnType<typeof this.player>,
        destination as Point,
      );
      if (!route || route.newDestination)
        throw new Error('Approved destination is no longer reachable');
    }
  }
  commit(t: Ticket, speech: string) {
    this.validate(t);
    if (!speech.trim() || speech.length > 350) throw new Error('Invalid speech; nothing committed');
    const l = this.game.world.livelihood!,
      clock = this.game.world.clock!.elapsedMs;
    // Effects derive from the validated ticket, never the generated wording.
    if (t.intent === 'invite_walk') {
      if (
        !proposeActivity(
          this.game,
          ids.Bob,
          ids.Lucky,
          { activity: 'walk', placeId: 'garden', destinationId: 'river', delayMinutes: 0 },
          this.now,
        )
      )
        throw new Error('Invitation rejected; speech not published');
      this.invitationId = l.activities!.at(-1)!.id;
      this.phase = 'offered';
    } else if (t.intent === 'home_then_quiet_hour' || t.intent === 'quiet_hour_then_home') {
      if (
        !respondActivity(
          this.game,
          this.invitationId!,
          ids.Lucky,
          'decline',
          this.now,
          'Chose solitude',
        )
      )
        throw new Error('Decline failed; speech not published');
      const minutes = 60;
      this.luckySequence = { choice: t.intent, state: 'pending', waitSamples: [] };
      const a = this.agent('Bob');
      a.awareness!.boundaries = rememberBoundary(
        a.awareness!.boundaries,
        ids.Lucky,
        ids.Bob,
        { scope: 'contact', activity: 'any', durationMinutes: minutes },
        t.id,
        clock,
      );
      this.phase = 'closing'; // Keep precisely one acknowledgment turn available.
    } else this.phase = 'closed';
    conversationInputs.finishSendingMessage.handler(this.game, this.now, {
      playerId: ids[t.actor],
      conversationId: this.conversationId!,
      timestamp: this.now,
    });
    this.transcript.push({ actor: t.actor, speech, decisionId: t.id });
    this.events.push({ kind: 'intent_committed', actor: t.actor, detail: t.intent, at: this.now });
    this.revision++;
    if (this.phase === 'closed') {
      this.game.world.conversations
        .get(this.conversationId!)!
        .leave(this.game, this.now, this.player(t.actor));
      this.startMove('Bob', t.intent === 'ack_home' ? destinations.bobHome : destinations.garden);
      if (this.luckySequence?.choice === 'quiet_hour_then_home') this.startQuietHour();
      else if (this.luckySequence) { this.luckySequence.state = 'walking'; this.startMove('Lucky', destinations.luckyHome); }
    }
  }
  private startQuietHour() {
    const plan = this.luckySequence!;
    plan.state = 'waiting'; plan.waitUntil = this.now + WORLD_HOUR_MS;
    stopPlayer(this.player('Lucky'));
    const boundary = this.agent('Bob').awareness!.boundaries!.find(b => b.speaker === ids.Lucky)!;
    boundary.expiresAt = this.game.world.clock!.elapsedMs + WORLD_HOUR_MS;
    this.events.push({ kind: 'wait_started', actor: 'Lucky', detail: JSON.stringify(this.player('Lucky').position), at: this.now });
  }
  private startMove(actor: Name, destination: Point) {
    const route = findRoute(this.game, this.now, this.player(actor), destination);
    if (!route || route.newDestination) throw new Error('Sequence interrupted: destination unreachable');
    movePlayer(this.game, this.now, this.player(actor), destination);
    this.paths.push({
      actor,
      destination: { ...destination },
      positions: [{ ...this.player(actor).position }],
      arrived: false,
      elapsedMs: 0,
      startedAt: this.now,
    });
    this.events.push({
      kind: 'movement_started',
      actor,
      detail: JSON.stringify(destination),
      at: this.now,
    });
  }
  executeMovement() {
    // Real production pathfinding/collision/position updates; autonomous scheduling
    // stays disabled in this isolated test so it cannot introduce an unrelated choice.
    const started = this.now, clockStarted = this.game.world.clock!.elapsedMs;
    for (let elapsed = 0; elapsed <= WORLD_HOUR_MS + 30000; elapsed += 100) {
      this.now = started + elapsed;
      this.game.world.clock!.elapsedMs = clockStarted + elapsed;
      this.game.world.livelihood!.clock = clockStarted + elapsed;
      const plan = this.luckySequence;
      if (plan?.state === 'waiting') {
        plan.waitSamples.push({ at: this.now, position: { ...this.player('Lucky').position } });
        if (this.now >= plan.waitUntil!) {
          this.events.push({ kind: 'wait_completed', actor: 'Lucky', detail: 'One village hour elapsed', at: this.now });
          if (plan.choice === 'quiet_hour_then_home') { plan.state = 'walking'; this.startMove('Lucky', destinations.luckyHome); }
          else plan.state = 'done';
        }
      }
      this.game.numPathfinds = 0;
      for (const p of this.game.world.players.values()) p.tickPathfinding(this.game, this.now);
      for (const p of this.game.world.players.values()) p.tickPosition(this.game, this.now);
      for (const path of this.paths) {
        if (path.arrived) continue;
        const p = this.player(path.actor);
        path.positions.push({ ...p.position });
        if (path.firstMovedAt === undefined && Math.hypot(p.position.x-path.positions[0].x,p.position.y-path.positions[0].y)>0.001) path.firstMovedAt=this.now;
        if (
          Math.hypot(p.position.x - path.destination.x, p.position.y - path.destination.y) < 0.01
        ) {
          path.arrived = true;
          path.elapsedMs = this.now - path.startedAt;
          stopPlayer(p);
          if (path.actor === 'Lucky' && this.luckySequence) {
            if (this.luckySequence.choice === 'home_then_quiet_hour') this.startQuietHour();
            else this.luckySequence.state = 'done';
          }
          this.events.push({
            kind: 'arrived',
            actor: path.actor,
            detail: JSON.stringify(p.position),
            at: this.now,
          });
        }
      }
      if (this.paths.every((p) => p.arrived) && (!this.luckySequence || this.luckySequence.state === 'done')) break;
    }
    if (this.luckySequence && this.luckySequence.state !== 'done') throw new Error('Sequence did not finish');
    return this.paths;
  }
  snapshot() {
    return {
      luckySequence: this.luckySequence,
      phase: this.phase,
      revision: this.revision,
      conversationOpen: this.game.world.conversations.has(this.conversationId!),
      invitation:
        this.game.world.livelihood!.activities?.find((s) => s.id === this.invitationId) ?? null,
      bobBoundaries: this.agent('Bob').awareness?.boundaries ?? [],
      positions: {
        Bob: { ...this.player('Bob').position },
        Lucky: { ...this.player('Lucky').position },
      },
      inventory: this.game.world.economy!.bags,
      transcript: this.transcript,
      events: this.events,
    };
  }
}
