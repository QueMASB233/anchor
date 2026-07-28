import { describe, expect, it } from 'vitest';

import { ACTION_VERSION } from '../src/index.js';

describe('@eleva/anchor-action', () => {
  it('exposes a version string', () => {
    expect(ACTION_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
