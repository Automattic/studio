import type { DataModel } from './types.js';
import type { ValidateModelResult } from './validate-model.js';

export interface ScaffoldTodo {
  path: string;
  instruction: string;
  evidence: string;
}

export interface DiscoveredArrayInfo {
  name: string;
  confidence: 'high' | 'low';
  recordCount?: number;
  reason?: string;
}

export interface ScaffoldResult {
  model: DataModel;
  skillTodos: ScaffoldTodo[];
  discovered: {
    /** Which records source fired. 'none' = neither JS arrays nor HTML cards yielded records. */
    source: 'js-array' | 'html-cards' | 'none';
    arrays: DiscoveredArrayInfo[];
    skippedFiles: string[];
    unmatchedContainers?: string[];
  };
  validation: ValidateModelResult;
}
