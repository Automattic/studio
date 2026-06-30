//
// Design-foundation CLI runner (non-agent fallback).
// ==================================================
// Three modes, selected by flags:
//   default       — scaffold, write template design-foundation.json with
//                   "TODO" sentinels in unfilled slots. Print next-step hints.
//   --validate    — read design-foundation.json, run schema + skillTodos
//                   check, print errors, exit non-zero on fail.
//   --render-md   — read design-foundation.json, regenerate
//                   design-foundation.md (no scaffold, no validation).
//
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { scaffoldDesignFoundation } from '../lib/design-foundation/scaffold.js';
import { DesignFoundationSchema, type PartialDesignFoundation, type DesignFoundation } from '../lib/design-foundation/schema.js';
import { renderMd } from '../lib/design-foundation/md-renderer.js';

export interface RunOpts {
  outputDir: string;
  origin?: string;
  validate?: boolean;
  renderMd?: boolean;
  force?: boolean;
  verbose?: boolean;
  // For tests: silence stdout/stderr.
  silent?: boolean;
}

export interface RunResult {
  exitCode: number;
  wrote?: string[];
  errors?: z.ZodIssue[];
}

export async function runDesignFoundationCli(opts: RunOpts): Promise<RunResult> {
  const { outputDir } = opts;
  const log = opts.silent ? () => {} : (m: string) => console.log(m);
  const err = opts.silent ? () => {} : (m: string) => console.error(m);

  if (opts.validate) {
    return runValidate(outputDir, { log, err });
  }
  if (opts.renderMd) {
    return runRenderMd(outputDir, { log, err });
  }
  return runScaffold(outputDir, { log, err, origin: opts.origin, force: opts.force });
}

function jsonPath(outputDir: string) {
  return join(outputDir, 'design-foundation.json');
}

function mdPath(outputDir: string) {
  return join(outputDir, 'design-foundation.md');
}

function runScaffold(
  outputDir: string,
  ctx: { log: (m: string) => void; err: (m: string) => void; origin: string | undefined; force: boolean | undefined },
): RunResult {
  const target = jsonPath(outputDir);
  if (!ctx.force && existsSync(target)) {
    ctx.err(`Error: ${target} already exists. Pass --force to overwrite, or use --validate / --render-md.`);
    return { exitCode: 1 };
  }
  const origin = ctx.origin ?? 'https://unknown.example';
  let partial: PartialDesignFoundation;
  try {
    partial = scaffoldDesignFoundation(outputDir, { origin });
  } catch (e) {
    ctx.err(`Error: ${(e as Error).message}`);
    return { exitCode: 1 };
  }
  const template = fillTodoSentinels(partial);
  mkdirSync(outputDir, { recursive: true });
  writeAtomic(target, JSON.stringify(template, null, 2) + '\n');
  ctx.log(`Wrote template: ${target}`);
  ctx.log('');
  ctx.log('Next steps:');
  ctx.log(`  1. Fill in the "TODO" slots in ${target}.`);
  ctx.log(`  2. Validate: data-liberation design-foundation ${outputDir} --validate`);
  ctx.log(`  3. Render MD: data-liberation design-foundation ${outputDir} --render-md`);
  ctx.log('');
  ctx.log(`skillTodos (${partial.skillTodos?.length ?? 0} slots to fill):`);
  for (const t of partial.skillTodos ?? []) ctx.log(`  - ${t}`);
  return { exitCode: 0, wrote: [target] };
}

function runValidate(
  outputDir: string,
  ctx: { log: (m: string) => void; err: (m: string) => void },
): RunResult {
  const path = jsonPath(outputDir);
  if (!existsSync(path)) {
    ctx.err(`Error: ${path} does not exist. Run without --validate to scaffold a template first.`);
    return { exitCode: 1 };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    ctx.err(`Error: ${path} is not valid JSON: ${(e as Error).message}`);
    return { exitCode: 1 };
  }
  const parsed = DesignFoundationSchema.safeParse(raw);
  if (!parsed.success) {
    ctx.err(`Validation failed — ${parsed.error.issues.length} issue(s):`);
    for (const issue of parsed.error.issues) {
      ctx.err(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    return { exitCode: 1, errors: parsed.error.issues };
  }
  // skillTodos ack check
  const f = parsed.data;
  const unfilled = f.skillTodos.filter((p) => !pathResolvesToValidRole(f, p));
  if (unfilled.length > 0) {
    ctx.err(`Validation failed — ${unfilled.length} skillTodos slot(s) still empty or TODO:`);
    for (const p of unfilled) ctx.err(`  ${p}`);
    return { exitCode: 1 };
  }
  ctx.log('Validation passed.');
  return { exitCode: 0 };
}

function runRenderMd(
  outputDir: string,
  ctx: { log: (m: string) => void; err: (m: string) => void },
): RunResult {
  const path = jsonPath(outputDir);
  if (!existsSync(path)) {
    ctx.err(`Error: ${path} does not exist.`);
    return { exitCode: 1 };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    ctx.err(`Error: ${path} is not valid JSON: ${(e as Error).message}`);
    return { exitCode: 1 };
  }
  const parsed = DesignFoundationSchema.safeParse(raw);
  if (!parsed.success) {
    ctx.err('Cannot render — JSON fails schema. Run --validate for details.');
    return { exitCode: 1 };
  }
  const mdTarget = mdPath(outputDir);
  writeAtomic(mdTarget, renderMd(parsed.data));
  ctx.log(`Wrote: ${mdTarget}`);
  return { exitCode: 0, wrote: [mdTarget] };
}

// Save-as-JSON template: replace null role slots with explicit "TODO" sentinel
// RoleObjs so the file is structurally close to a valid DesignFoundation but
// flagged as incomplete. Operator edits by hand; --validate catches unfilled.
function fillTodoSentinels(p: PartialDesignFoundation): unknown {
  const sentinelRole = { value: 'TODO', role: 'TODO', evidence: ['TODO'] };
  const sentinelGradient = { css: 'TODO', role: 'TODO', evidence: ['TODO'] };

  const fillRoleMap = (m: Record<string, unknown> | undefined) => {
    if (!m) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m)) {
      out[k] = v === null ? sentinelRole : v;
    }
    return out;
  };
  const fillGradientMap = (m: Record<string, unknown> | undefined) => {
    if (!m) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m)) {
      out[k] = v === null ? sentinelGradient : v;
    }
    return out;
  };

  return {
    ...p,
    color: {
      surface: fillRoleMap(p.color?.surface as Record<string, unknown> | undefined),
      text: fillRoleMap(p.color?.text as Record<string, unknown> | undefined),
      accent: fillRoleMap(p.color?.accent as Record<string, unknown> | undefined),
      border: fillRoleMap(p.color?.border as Record<string, unknown> | undefined),
    },
    gradient: fillGradientMap(p.gradient as Record<string, unknown> | undefined),
    typography: {
      ...p.typography,
      families: fillRoleMap(p.typography?.families as Record<string, unknown> | undefined),
    },
  };
}

function pathResolvesToValidRole(f: DesignFoundation, dottedPath: string): boolean {
  const parts = dottedPath.split('.');
  let cur: unknown = f;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (!cur || typeof cur !== 'object') return false;
  const role = cur as { value?: unknown; role?: unknown; evidence?: unknown; css?: unknown };
  const hasEvidence = Array.isArray(role.evidence) && role.evidence.length > 0
    && !(role.evidence as unknown[]).every((x) => x === 'TODO');
  const hasValue = (typeof role.value === 'string' && role.value.length > 0 && role.value !== 'TODO')
    || (typeof role.css === 'string' && role.css.length > 0 && role.css !== 'TODO');
  const hasRole = typeof role.role === 'string' && role.role.length > 0 && role.role !== 'TODO';
  return hasEvidence && hasValue && hasRole;
}

function writeAtomic(path: string, content: string): void {
  const tmp = path + '.tmp';
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}

// Invoked by src/cli.ts for the `design-foundation` subcommand. Exits with
// the process exit code from RunResult.
export async function runDesignFoundationCliFromArgs(opts: RunOpts): Promise<void> {
  const result = await runDesignFoundationCli(opts);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
