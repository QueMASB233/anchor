import { describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/index.js';

describe('@eleva/anchor-core', () => {
  it('exposes a version string', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
