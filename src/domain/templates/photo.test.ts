import { describe, expect, it } from 'vitest';

import { activity, snapshot, stage } from '../__fixtures__/plan';
import { sampleTemplate, snapshotFromDraft } from '../__fixtures__/templates';
import { applyTemplate } from './apply';
import { exportTemplate } from './export';
import type { Template } from './format';
import { TEMPLATE_PROBLEM_KEYS as K, validateTemplate } from './validate';

/**
 * A check's optional `"photo": true` (slice D3, decision 2): hidden work, whose `yes` needs its
 * photo. Validated as a boolean, applied as the draft check's `needsPhoto`, exported back.
 */

const NONE = new Map<string, Template>();

/** The sample template with its strip-out close check flagged (or the value given). */
function flagged(photo: unknown = true): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(sampleTemplate())) as {
    stages: Array<{ checks?: { close?: Array<Record<string, unknown>> } }>;
  };
  raw.stages[0]!.checks!.close![0]!.photo = photo;
  return raw as unknown as Record<string, unknown>;
}

describe('the photo flag on a template check', () => {
  it('is accepted, true or false, in the library and in a file', () => {
    for (const origin of ['library', 'file'] as const) {
      for (const photo of [true, false]) {
        const result = validateTemplate(flagged(photo), origin, NONE);
        expect(result.ok).toBe(true);
      }
    }
  });

  it('is refused when it is not a boolean, at its own path', () => {
    for (const photo of ['yes', 1, null]) {
      const result = validateTemplate(flagged(photo), 'library', NONE);
      expect(result).toEqual({
        ok: false,
        problems: [
          {
            path: '$.stages[0].checks.close[0].photo',
            key: K.type,
            detail: { expected: 'boolean' },
          },
        ],
      });
    }
  });

  it('is the only field a check may add to its text', () => {
    const raw = flagged();
    const close = (raw.stages as Array<{ checks: { close: Array<Record<string, unknown>> } }>)[0]!
      .checks.close;
    close[0]!.required = true;
    const result = validateTemplate(raw, 'file', NONE);
    expect(result.ok ? [] : result.problems.map((p) => `${p.path} ${p.key}`)).toEqual([
      '$.stages[0].checks.close[0].required template.problem.unknownField',
    ]);
  });

  it('does not stand in for the text: a check with only a photo has no language', () => {
    const raw = JSON.parse(JSON.stringify(sampleTemplate())) as Record<string, unknown>;
    (raw.stages as Array<{ checks: { start: unknown[] } }>)[0]!.checks.start[0] = { photo: true };
    const result = validateTemplate(raw, 'file', NONE);
    expect(result.ok ? [] : result.problems.map((p) => `${p.path} ${p.key}`)).toEqual([
      '$.stages[0].checks.start[0] template.problem.textEmpty',
    ]);
  });

  it("is applied as the draft check's needsPhoto; absent or false is a check like any other", () => {
    const template = validateTemplate(flagged(), 'library', NONE);
    if (!template.ok) throw new Error('the sample must validate');
    const { draft } = applyTemplate(template.template, NONE, 'en');
    expect(draft.stages[0]!.checks).toEqual([
      { gate: 'start', name: 'Is the water shut off?', needsPhoto: false },
      { gate: 'close', name: 'Is the rubble gone?', needsPhoto: true },
    ]);
    const off = validateTemplate(flagged(false), 'library', NONE);
    if (!off.ok) throw new Error('the sample must validate');
    expect(
      applyTemplate(off.template, NONE, 'pt-BR').draft.stages[0]!.checks.map((c) => c.needsPhoto),
    ).toEqual([false, false]);
  });

  it('comes back on export, and only where it is set: template → work → template', () => {
    const template = validateTemplate(flagged(), 'library', NONE);
    if (!template.ok) throw new Error('the sample must validate');
    const work = snapshotFromDraft(applyTemplate(template.template, NONE, 'en').draft);
    expect(work.checks.map((check) => check.needsPhoto)).toEqual([false, true]);

    const exported = exportTemplate(work, {
      numbers: 'strip',
      language: 'en',
      id: 'again',
      title: 'Again',
    });
    expect(exported.stages[0]!.checks).toEqual({
      start: [{ en: 'Is the water shut off?' }],
      close: [{ en: 'Is the rubble gone?', photo: true }],
    });
    // And it goes round again unchanged.
    const again = validateTemplate(exported, 'file', NONE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const twice = exportTemplate(
      snapshotFromDraft(applyTemplate(again.template, NONE, 'en').draft),
      {
        numbers: 'strip',
        language: 'en',
        id: 'again',
        title: 'Again',
      },
    );
    expect(twice).toEqual(exported);
  });

  it('is exported from a work whose check was flagged by hand', () => {
    const work = snapshot({
      stages: [stage('s', 1, 'Plumbing')],
      activities: [activity('a', 's', 1, 2)],
      checks: [
        {
          id: 'k',
          stageId: 's',
          gate: 'close',
          position: 1,
          name: 'Pipes photographed before the wall is closed',
          needsPhoto: true,
        },
      ],
    });
    const exported = exportTemplate(work, {
      numbers: 'keep',
      language: 'pt-BR',
      id: 'mine',
      title: 'Mine',
    });
    expect(exported.stages[0]!.checks).toEqual({
      close: [{ 'pt-BR': 'Pipes photographed before the wall is closed', photo: true }],
    });
  });
});
