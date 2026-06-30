// src/lib/replicate/budget-guard.ts
// A run that exceeds a configurable subagent / cluster / elapsed-time ceiling
// should pause and ask the operator rather than running away. Pure decision fn.
export interface BudgetState { subagents: number; clusters: number; elapsedMs: number; }
export interface BudgetLimits { maxSubagents?: number; maxClusters?: number; maxElapsedMs?: number; }
export interface BudgetDecision { action: 'continue' | 'pause'; reason?: string; }

export function checkBudget(state: BudgetState, limits: BudgetLimits): BudgetDecision {
  if (limits.maxSubagents !== undefined && state.subagents >= limits.maxSubagents) {
    return { action: 'pause', reason: `subagent ceiling reached (${state.subagents}/${limits.maxSubagents})` };
  }
  if (limits.maxClusters !== undefined && state.clusters >= limits.maxClusters) {
    return { action: 'pause', reason: `cluster ceiling reached (${state.clusters}/${limits.maxClusters})` };
  }
  if (limits.maxElapsedMs !== undefined && state.elapsedMs >= limits.maxElapsedMs) {
    return { action: 'pause', reason: `time ceiling reached (${state.elapsedMs}/${limits.maxElapsedMs}ms)` };
  }
  return { action: 'continue' };
}
