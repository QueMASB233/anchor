import { describe, expect, it } from 'vitest';

import { CLI_VERSION } from '../src/index.js';

describe('@eleva/anchor', () => {
  it('exposes a version string', () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
