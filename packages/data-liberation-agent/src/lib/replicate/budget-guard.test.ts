import { describe, it, expect } from 'vitest';
import { checkBudget } from './budget-guard.js';

describe('checkBudget', () => {
  it('continues within all limits', () => {
    expect(checkBudget({ subagents: 1, clusters: 1, elapsedMs: 1000 }, { maxSubagents: 10, maxClusters: 10, maxElapsedMs: 60000 }).action).toBe('continue');
  });
  it('pauses on subagent ceiling', () => {
    const d = checkBudget({ subagents: 10, clusters: 1, elapsedMs: 0 }, { maxSubagents: 10 });
    expect(d.action).toBe('pause');
    expect(d.reason).toMatch(/subagent ceiling/);
  });
  it('pauses on cluster ceiling', () => {
    expect(checkBudget({ subagents: 0, clusters: 40, elapsedMs: 0 }, { maxClusters: 40 }).action).toBe('pause');
  });
  it('pauses on time ceiling', () => {
    expect(checkBudget({ subagents: 0, clusters: 0, elapsedMs: 99999 }, { maxElapsedMs: 60000 }).action).toBe('pause');
  });
  it('continues when no limits are set', () => {
    expect(checkBudget({ subagents: 999, clusters: 999, elapsedMs: 999999 }, {}).action).toBe('continue');
  });
});
