import { parse } from 'acorn';
import { runInNewContext } from 'node:vm';
import * as cheerio from 'cheerio';

export type Confidence = 'high' | 'low';

const MAX_EVIDENCE = 400;
const MAX_EVAL_CHARS = 200_000;
const MAX_RECORDS = 5_000;

export interface DiscoveredArray {
  name: string;
  records?: Array<Record<string, unknown>>;
  confidence: Confidence;
  evidence: string;
}

export interface DiscoveredMount {
  selector: string;
  wrapperClass?: string;
  sourceCall?: string;
  perPageHint?: number;
  confidence: Confidence;
  evidence: string;
}

export function parseProgram(js: string): any | null {
  try {
    return parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }) as unknown as any;
  } catch {
    return null;
  }
}

export function walk(node: any, visit: (n: any) => void): void {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const k of Object.keys(node)) {
    if (k === 'start' || k === 'end' || k === 'type') continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v) walk(c, visit);
    } else if (v && typeof v.type === 'string') {
      walk(v, visit);
    }
  }
}

function evidenceFor(js: string, node: any): string {
  const slice = js.slice(node.start, node.end);
  return slice.length > MAX_EVIDENCE ? `${slice.slice(0, MAX_EVIDENCE)}...` : slice;
}

function looksLikeRecordArray(el: any): boolean {
  if (!el || el.type !== 'ArrayExpression' || el.elements.length === 0) return false;
  return el.elements.every((e: any) => {
    if (!e || e.type !== 'ObjectExpression') return false;
    return (e.properties ?? []).some((p: any) => {
      const k = p.key?.name ?? p.key?.value;
      return k === 'id' || k === 'slug' || (typeof k === 'string' && /id$/i.test(k));
    });
  });
}

function isStaticLiteral(node: any): boolean {
  if (!node) return false;
  if (node.type === 'Literal') return true;
  if (node.type === 'ArrayExpression') return (node.elements ?? []).every((el: any) => el === null || isStaticLiteral(el));
  if (node.type === 'ObjectExpression') {
    return (node.properties ?? []).every((prop: any) => {
      if (!prop || prop.type !== 'Property' || prop.kind !== 'init' || prop.method || prop.shorthand) return false;
      if (prop.computed && !isStaticLiteral(prop.key)) return false;
      return isStaticLiteral(prop.value);
    });
  }
  if (node.type === 'UnaryExpression' && ['-', '+', '!', '~'].includes(node.operator)) return isStaticLiteral(node.argument);
  if (node.type === 'TemplateLiteral') return (node.expressions ?? []).length === 0;
  return false;
}

function evalArray(js: string, node: any): { records?: Array<Record<string, unknown>>; confidence: Confidence; evidence: string } {
  const slice = js.slice(node.start, node.end);
  const evidence = evidenceFor(js, node);
  if (slice.length > MAX_EVAL_CHARS) return { confidence: 'low', evidence: `literal too large (${slice.length} chars) :: ${evidence}` };
  if (!isStaticLiteral(node)) return { confidence: 'low', evidence };
  try {
    const records = runInNewContext(`(${slice})`, Object.create(null), { timeout: 1000 }) as Array<Record<string, unknown>>;
    if (!Array.isArray(records) || records.length > MAX_RECORDS) return { confidence: 'low', evidence };
    return { records, confidence: 'high', evidence };
  } catch (e) {
    return { confidence: 'low', evidence: `${(e as Error).message} :: ${evidence}` };
  }
}

function nameFor(parentHint: string | undefined): string {
  return parentHint ?? '(anonymous)';
}

export function discoverDataArrays(js: string): DiscoveredArray[] {
  const ast = parseProgram(js);
  if (!ast) return [];
  const out: DiscoveredArray[] = [];
  const seen = new Set<number>();

  const consider = (arrNode: any, hint?: string): void => {
    if (!looksLikeRecordArray(arrNode) || seen.has(arrNode.start)) return;
    seen.add(arrNode.start);
    out.push({ name: nameFor(hint), ...evalArray(js, arrNode) });
  };

  walk(ast, (n: any) => {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier') consider(n.init, n.id.name);
    if (n.type === 'AssignmentExpression') {
      const left = n.left;
      const hint = left?.type === 'Identifier' ? left.name : left?.property?.name;
      consider(n.right, hint);
    }
    if (n.type === 'Property') consider(n.value, n.key?.name ?? n.key?.value);
    if (n.type === 'ReturnStatement') consider(n.argument, undefined);
  });
  return out;
}

const SELECTOR_RE = /^(#[\w-]+|\.[\w-]+|\[[\w-]+(=("[^"]*"|'[^']*'|[\w-]+))?\])$/;

function perPageFrom(callNode: any): number | undefined {
  for (const a of callNode.arguments ?? []) {
    if (a.type === 'Literal' && typeof a.value === 'number') return a.value;
  }
  for (const a of callNode.arguments ?? []) {
    if (a.type === 'CallExpression') {
      const inner = (a.arguments ?? []).find((x: any) => x.type === 'Literal' && typeof x.value === 'number');
      if (inner) return inner.value;
    }
  }
  return undefined;
}

export function discoverMounts(html: string, js: string): DiscoveredMount[] {
  const $ = cheerio.load(html);
  const ast = parseProgram(js);
  const callsBySelector = new Map<string, { source: string; perPage?: number }>();

  if (ast) {
    walk(ast, (n: any) => {
      if (n.type !== 'CallExpression') return;
      const sel = (n.arguments ?? [])
        .filter((a: any) => a.type === 'Literal' && typeof a.value === 'string')
        .map((a: any) => String(a.value))
        .find((v: string) => SELECTOR_RE.test(v));
      if (sel && !callsBySelector.has(sel)) callsBySelector.set(sel, { source: js.slice(n.start, n.end), perPage: perPageFrom(n) });
    });
  }

  const out: DiscoveredMount[] = [];
  const claimed = new Set<string>();

  for (const [selector, call] of callsBySelector) {
    const el = $(selector).first();
    if (el.length === 0) continue;
    claimed.add(selector);
    out.push({
      selector,
      wrapperClass: el.attr('class') || undefined,
      sourceCall: call.source,
      perPageHint: call.perPage,
      confidence: 'high',
      evidence: call.source,
    });
  }

  $('[id]').each((_, el) => {
    const id = $(el).attr('id')!;
    const selector = `#${id}`;
    if (claimed.has(selector)) return;
    if ($(el).children().length > 0) return;
    out.push({
      selector,
      wrapperClass: $(el).attr('class') || undefined,
      confidence: 'low',
      evidence: `empty container ${selector} has no matching JS call`,
    });
  });

  return out;
}

export function discoverIdLookups(js: string): string[] {
  const ast = parseProgram(js);
  if (!ast) return [];
  const names = new Set<string>();
  const touchesId = (n: any) => n?.type === 'MemberExpression' && n.property?.name === 'id';
  walk(ast, (n: any) => {
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      n.callee.property?.name === 'find' &&
      n.callee.object?.type === 'Identifier'
    ) {
      const body = n.arguments?.[0]?.body;
      if (body?.type === 'BinaryExpression' && /^===?$/.test(body.operator) && (touchesId(body.left) || touchesId(body.right))) {
        names.add(n.callee.object.name);
      }
    }
  });
  return [...names];
}
