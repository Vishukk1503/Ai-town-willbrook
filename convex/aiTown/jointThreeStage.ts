import { decodeJointResponse } from './jointResponse';
import type { LifeOption } from './livelihoodActions';
import type { Game } from './game';
import type { Agent } from './agent';

export function planSchema(ids: string[]) {
  const conversation = ids.filter((id) => ['chat', 'end'].includes(id));
  const actions = ids.filter((id) => !['chat', 'end', 'plan'].includes(id));
  return {
    type: 'object',
    properties: {
      choice: {
        anyOf: [
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['conversation'] },
              action: { type: 'string', enum: conversation },
            },
            required: ['kind', 'action'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['actions'] },
              steps: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: {
                  type: 'object',
                  properties: {
                    action: { type: 'string', enum: [...actions, 'wait'] },
                    durationMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                  },
                  required: ['action', 'durationMinutes'],
                  additionalProperties: false,
                },
              },
            },
            required: ['kind', 'steps'],
            additionalProperties: false,
          },
        ],
      },
      reason: { type: 'string' },
    },
    required: ['choice', 'reason'],
    additionalProperties: false,
  };
}
export function decodePlan(
  raw: string,
  ids: string[],
  town: Pick<LifeOption, 'id' | 'kind' | 'target'>[],
) {
  const p = JSON.parse(raw);
  if (
    !p ||
    typeof p.reason !== 'string' ||
    !p.choice ||
    Object.keys(p).some((k) => !['choice', 'reason'].includes(k))
  )
    throw Error('Invalid plan');
  const c = p.choice;
  let selected: { action: string; durationMinutes: number | null }[];
  if (
    c.kind === 'conversation' &&
    ['chat', 'end'].includes(c.action) &&
    Object.keys(c).every((k) => ['kind', 'action'].includes(k))
  )
    selected = [{ action: c.action, durationMinutes: null }];
  else if (
    c.kind === 'actions' &&
    Array.isArray(c.steps) &&
    c.steps.length &&
    Object.keys(c).every((k) => ['kind', 'steps'].includes(k)) &&
    c.steps.every(
      (s: any) =>
        s &&
        !['chat', 'end', 'plan'].includes(s.action) &&
        Object.keys(s).every((k) => ['action', 'durationMinutes'].includes(k)),
    )
  )
    selected = c.steps;
  else throw Error('Invalid action/conversation combination');
  // Reuse the existing parameter decoder. This marker is validation-only and is never published.
  const d = decodeJointResponse(
    {
      decisions: selected.map((s, i) => ({ ...s, words: i === 0 ? 'Internal validation' : '' })),
      reason: p.reason,
    },
    ids,
    town,
  );
  return { action: d.action, steps: d.steps, reason: d.reason, selected };
}
// A replacement plan is a proposal until engine validation and comparison pass.
export function speechSchema(ids: string[]) {
  return {
    type: 'object',
    properties: {
      speech: { type: 'string' },
      proposedPlan: { anyOf: [planSchema(ids), { type: 'null' }] },
    },
    required: ['speech', 'proposedPlan'], additionalProperties: false,
  };
}
export const reviewSchema = {
  type: 'object',
  properties: {
    statements: {
      type: 'array', minItems: 1,
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          kind: { type: 'string', enum: ['commitment', 'invitation', 'fact', 'expression'] },
          actionIndexes: { type: 'array', items: { type: 'integer' } },
          evidence: { type: 'string' },
          verdict: { type: 'string', enum: ['supported', 'unsupported', 'no_action_needed'] },
        },
        required: ['quote', 'kind', 'actionIndexes', 'evidence', 'verdict'],
        additionalProperties: false,
      },
    },
  },
  required: ['statements'], additionalProperties: false,
};
export function parseSpeech(raw: string) {
  const d = JSON.parse(raw);
  if (!d || typeof d.speech !== 'string' ||
      !d.speech.trim())
    throw Error('Invalid spoken text');
  return d.speech.trim();
}
export function parseReview(raw: string, speech: string, actionCount: number) {
  const d = JSON.parse(raw);
  if (!d || !Array.isArray(d.statements) || !d.statements.length ||
      Object.keys(d).some(k => k !== 'statements')) throw Error('Missing statement comparison');
  let cursor = 0;
  const issues: {quote: string; reason: string}[] = [];
  for (const s of d.statements) {
    if (!s || typeof s.quote !== 'string' || !s.quote.trim() ||
        !['commitment','invitation','fact','expression'].includes(s.kind) ||
        !['supported','unsupported','no_action_needed'].includes(s.verdict) ||
        typeof s.evidence !== 'string' || !s.evidence.trim() ||
        !Array.isArray(s.actionIndexes) ||
        s.actionIndexes.some((i: unknown) => !Number.isInteger(i) || (i as number) < 0 || (i as number) >= actionCount))
      throw Error('Invalid statement comparison');
    const offset = speech.indexOf(s.quote, cursor);
    if (offset < 0 || speech.slice(cursor, offset).trim())
      throw Error('Comparison skipped or altered spoken text');
    cursor = offset + s.quote.length;
    if (s.verdict === 'unsupported' ||
        (['commitment', 'invitation'].includes(s.kind) &&
         (s.verdict !== 'supported' || !s.actionIndexes.length)) ||
        (s.kind === 'fact' && s.verdict !== 'supported'))
      issues.push({quote: s.quote, reason: s.evidence});
  }
  if (speech.slice(cursor).trim()) throw Error('Comparison omitted the end of the speech');
  return {approved: issues.length === 0, issues, statements: d.statements};
}
export function reviewBasis(game: Game, a: Agent) {
  // Avoid changing clock/position values: resource and agreement changes invalidate approval.
  const l = game.world.livelihood;
  return JSON.stringify({
    bags: game.world.economy?.bags,
    offers: l?.offers,
    activities: l?.activities,
    garden: game.world.garden
      ? { seeds: game.world.garden.seeds, food: game.world.garden.food }
      : null,
  });
}
export async function threeStage<T extends { selected: unknown[] }>(o: {
  choose: (attempt: number, feedback: unknown) => Promise<string>;
  validate: (raw: string) => Promise<T>;
  speak: (plan: T, attempt: number, feedback: unknown) => Promise<string>;
  // Offline evaluations may opt in; live town dialogue does not require review.
  review?: (plan: T, speech: string, attempt: number) => Promise<string>;
  commit: (plan: T, speech: string, attempt: number) => Promise<void>;
  maxRepairs?: number;
  onInvalidAction?: (error: string) => T;
}) {
  const validate = async (raw: string) => {
    try { return await o.validate(raw); }
    catch (e) {
      if (!o.onInvalidAction) throw e;
      return o.onInvalidAction(e instanceof Error ? e.message : 'Action unavailable');
    }
  };
  let feedback: unknown = null;
  for (let attempt = 0; attempt <= (o.maxRepairs ?? 1); attempt++) {
    let plan: T | undefined, speech: string | undefined;
    try {
      plan = await validate(await o.choose(attempt, feedback));
      const draft = await o.speak(plan, attempt, feedback);
      speech = parseSpeech(draft);
      const proposed = JSON.parse(draft).proposedPlan;
      if (proposed != null) plan = await validate(JSON.stringify(proposed));
      if (o.review) {
        const verdict = parseReview(await o.review(plan, speech!, attempt), speech!, plan.selected.length);
        if (!verdict.approved) throw Error('Review rejected: ' + JSON.stringify(verdict.issues));
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (attempt === (o.maxRepairs ?? 1)) throw Error(error);
      feedback = {plan: plan ?? null, speech: speech ?? null, error};
      continue;
    }
    // A stale/failed commit is never repaired by generating another turn.
    await o.commit(plan!, speech!, attempt);
    return;
  }
}

export function sameSteps(
  a: { action: string; target: string | null; durationMinutes: number | null }[],
  b: { action: string; target: string | null; durationMinutes: number | null }[],
) {
  return (
    a.length === b.length &&
    a.every(
      (s, i) =>
        s.action === b[i].action &&
        s.target === b[i].target &&
        s.durationMinutes === b[i].durationMinutes,
    )
  );
}
