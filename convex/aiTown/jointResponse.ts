import type { LifeOption } from './livelihoodActions';
import type { PlanStep } from './planActions';
// Exactly one representation of intent: no competing root action / plan fields.
export function jointResponseSchema(ids: string[]) {
  return {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...ids, 'wait'] },
            durationMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            words: { type: 'string' },
          },
          required: ['action', 'durationMinutes', 'words'],
          additionalProperties: false,
        },
      },
      reason: { type: 'string' },
    },
    required: ['decisions', 'reason'],
    additionalProperties: false,
  };
}
export function decodeJointResponse(
  value: unknown,
  ids: string[],
  town: Pick<LifeOption, 'id' | 'kind' | 'target'>[],
) {
  const response = value as {
    decisions: { action: string; durationMinutes: number | null; words: string }[];
    reason: string;
  };
  if (
    !response ||
    typeof response !== 'object' ||
    Object.keys(response).some((k) => !['decisions', 'reason'].includes(k)) ||
    !Array.isArray(response.decisions) ||
    response.decisions.length < 1 ||
    response.decisions.length > 3 ||
    typeof response.reason !== 'string'
  )
    throw new Error('Invalid joint response');
  for (const decision of response.decisions) {
    if (
      !decision ||
      Object.keys(decision).some((k) => !['action', 'durationMinutes', 'words'].includes(k)) ||
      typeof decision.words !== 'string'
    )
      throw new Error('Invalid decision words');
  }
  const decisionWords = response.decisions.map((d) => ({ ...d, words: d.words.trim() }));
  const speech = decisionWords
    .map((d) => d.words)
    .filter(Boolean)
    .join(' ');
  if (!speech || speech.length > 350) throw new Error('Decision words must total 1-350 characters');
  const d = {
    steps: decisionWords.map(({ words, ...step }) => step),
    reason: response.reason,
    speech,
  };
  for (const s of d.steps) {
    if (
      !s ||
      Object.keys(s).some((k) => !['action', 'durationMinutes'].includes(k)) ||
      ![...ids, 'wait'].includes(s.action) ||
      (s.durationMinutes !== null &&
        (!Number.isInteger(s.durationMinutes) || s.durationMinutes < 1))
    )
      throw new Error('Invalid selected step');
  }
  const only = d.steps.length === 1 ? d.steps[0] : null;
  if (only && only.action !== 'wait' && only.durationMinutes === null)
    return {
      action: only.action,
      steps: [] as PlanStep[],
      reason: d.reason,
      speech: d.speech,
      decisionWords,
    };
  const steps: PlanStep[] = d.steps.map((s) => {
    const o = town.find((o) => o.id === s.action);
    if (s.action === 'wait' || (s.action === 'rest' && o)) {
      if (s.durationMinutes === null) throw new Error('Choose a duration for this step');
      return {
        action: s.action as 'wait' | 'rest',
        target: null,
        durationMinutes: s.durationMinutes,
      };
    }
    if (!o) throw new Error('Chat and end must be the sole step');
    if (
      ['fish', 'garden', 'cook', 'collect', 'forage'].includes(o.kind) &&
      s.durationMinutes !== null
    )
      return { action: 'work', target: o.id, durationMinutes: s.durationMinutes };
    if (s.durationMinutes !== null) throw new Error('This action has engine-controlled duration');
    if (o.kind === 'eat') return { action: 'eat', target: o.id, durationMinutes: null };
    if (o.id === 'walk:river' || o.id === 'walk:garden')
      return { action: 'walk', target: o.id.slice(5), durationMinutes: null };
    return { action: 'town', target: o.id, durationMinutes: null };
  });
  return { action: 'plan', steps, reason: d.reason, speech: d.speech, decisionWords };
}

// Structural binding only: this does not pretend to understand arbitrary prose.
export function validateDecisionWords(turn: {
  action: string;
  steps: PlanStep[];
  speech: string;
  decisionWords?: { action: string; durationMinutes: number | null; words: string }[];
}) {
  if (!turn.decisionWords) return; // Previously queued engine inputs remain readable.
  const expected =
    turn.action === 'plan'
      ? turn.steps.map((s) => ({
          action:
            s.action === 'walk'
              ? 'walk:' + s.target
              : ['town', 'work', 'eat'].includes(s.action)
                ? s.target
                : s.action,
          durationMinutes: s.durationMinutes,
        }))
      : [{ action: turn.action, durationMinutes: null }];
  if (
    expected.length !== turn.decisionWords.length ||
    expected.some(
      (e, i) =>
        e.action !== turn.decisionWords![i].action ||
        e.durationMinutes !== turn.decisionWords![i].durationMinutes,
    ) ||
    turn.decisionWords
      .map((d) => d.words.trim())
      .filter(Boolean)
      .join(' ') !== turn.speech
  )
    throw new Error('Decision words do not match the submitted decisions');
}
