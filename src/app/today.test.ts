import { describe, expect, it } from 'vitest';

import { today } from './today';

describe('today', () => {
  it('is the local calendar day, as YYYY-MM-DD, whatever the hour', () => {
    expect(today(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05');
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(today(new Date(2026, 11, 31, 12))).toBe('2026-12-31');
  });
});
