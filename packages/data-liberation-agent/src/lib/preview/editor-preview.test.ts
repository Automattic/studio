// src/lib/preview/editor-preview.test.ts
//
// Hermetic unit tests for the editor-fidelity surface's PURE helpers. The live
// renderer (openEditorSession/renderEditorCanvas) needs a logged-in Studio
// editor and is exercised by the env-gated integration block at the bottom +
// the .tmp-test driver — never in the hermetic suite.
import { describe, it, expect } from 'vitest';
import {
  EDITOR_CANVAS_NEUTRALIZE_CSS,
  markupHasDlaBlocks,
  editorScorePolicy,
  buildEditorRepairTask,
} from './editor-preview.js';

describe('markupHasDlaBlocks', () => {
  it('detects dla/* interactivity blocks', () => {
    expect(markupHasDlaBlocks('<!-- wp:dla/reveal -->x<!-- /wp:dla/reveal -->')).toBe(true);
    expect(markupHasDlaBlocks('<!-- wp:dla/slider {"intervalMs":4000} -->x<!-- /wp:dla/slider -->')).toBe(true);
  });
  it('is false for pure core/dla-free markup', () => {
    expect(markupHasDlaBlocks('<!-- wp:heading -->\n<h2>x</h2>\n<!-- /wp:heading -->')).toBe(false);
    // A paragraph that merely mentions the text "dla/" is not a block opener.
    expect(markupHasDlaBlocks('<!-- wp:paragraph -->\n<p>see dla/reveal docs</p>\n<!-- /wp:paragraph -->')).toBe(false);
  });
});

describe('editorScorePolicy', () => {
  it('blocks-path core-only → editorScore JOINS the verdict', () => {
    expect(editorScorePolicy({ blocksPath: true, hasDlaBlocks: false })).toEqual({ mode: 'verdict' });
  });
  it('local-site native (carry) without dla → measure + WARN only', () => {
    expect(editorScorePolicy({ blocksPath: false, hasDlaBlocks: false })).toEqual({ mode: 'warn' });
  });
  it('any page carrying dla/* → SKIP scoring (placeholder sections, honest null)', () => {
    expect(editorScorePolicy({ blocksPath: true, hasDlaBlocks: true })).toEqual({ mode: 'skip-dla' });
    expect(editorScorePolicy({ blocksPath: false, hasDlaBlocks: true })).toEqual({ mode: 'skip-dla' });
  });
});

describe('EDITOR_CANVAS_NEUTRALIZE_CSS', () => {
  it('hides the post title so the canvas matches the no-title frontend template', () => {
    expect(EDITOR_CANVAS_NEUTRALIZE_CSS).toMatch(/wp-block-post-title|editor-post-title/);
    expect(EDITOR_CANVAS_NEUTRALIZE_CSS).toContain('display:none');
  });
});

describe('buildEditorRepairTask', () => {
  it('emits an editor-surface task for a sub-floor editor score', () => {
    const t = buildEditorRepairTask('/scent/', 'desktop', { status: 'ok', score: 0.8, heightDelta: 4, heightPass: true }, 0.99);
    expect(t).toEqual({ surface: 'editor', pathname: '/scent/', viewport: 'desktop', kind: 'mismatch', score: 0.8, heightDelta: 4 });
  });
  it('marks kind=height when the editor canvas height diverges', () => {
    const t = buildEditorRepairTask('/x/', 'mobile', { status: 'ok', score: 0.999, heightDelta: 40, heightPass: false }, 0.99);
    expect(t?.kind).toBe('height');
  });
  it('emits nothing for a passing editor score', () => {
    expect(buildEditorRepairTask('/x/', 'desktop', { status: 'ok', score: 1, heightDelta: 0, heightPass: true }, 0.99)).toBeNull();
  });
  it('emits nothing for a null/non-ok score (skip-dla or missing render)', () => {
    expect(buildEditorRepairTask('/x/', 'desktop', { status: 'ok', score: null }, 0.99)).toBeNull();
    expect(buildEditorRepairTask('/x/', 'desktop', { status: 'missing-replica', score: null }, 0.99)).toBeNull();
  });
});
