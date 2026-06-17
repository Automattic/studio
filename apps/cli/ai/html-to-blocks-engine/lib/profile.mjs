// Profiling helpers for the html-to-wordpress-blocks toolchain.
//
// Design rules (see docs/profiling-plan.md):
// - In-process durations use performance.now() (monotonic).
// - Cross-process ordering uses Date.now() epoch ms (tsEpochMs).
// - NEVER write profiling output to stdout: stdout carries the Content-Length
//   MCP JSON-RPC stream. Profiling goes to stderr or files only.
// - Every function is safe to call when profiling is off, with ~zero overhead
//   on the hot path when WBDC_PROFILE is unset.

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';

// Per-process state. A flat buffer of recorded spans/events plus a depth counter
// for flamegraph nesting and a shallow run-metadata bag.
const _buffer = [];
let _depth = 0;
let _runMeta = {};
let _exitHookRegistered = false;

const _ON_VALUES = new Set(['on', 'deep', '1', 'true']);

// --- env gates ---------------------------------------------------------------

export function isOn() {
    return _ON_VALUES.has(process.env.WBDC_PROFILE);
}

export function isDeep() {
    return process.env.WBDC_PROFILE === 'deep';
}

export function isNet() {
    return process.env.WBDC_PROFILE_NET === '1';
}

// --- recording ---------------------------------------------------------------

function _registerExitHook() {
    if (_exitHookRegistered) return;
    _exitHookRegistered = true;
    // Per-call processes (mcp-call.sh driver mode) exit after one tool call;
    // flushing on exit persists their spans automatically.
    process.on('exit', () => {
        try {
            flush();
        } catch {
            // Never let a profiling failure crash the host process.
        }
    });
}

// tsEpochMs anchors a span at its START (open time), so cross-process ordering
// and speedscope nesting reflect when work began — not when it finished. A
// parent span finishes (is recorded) after its children, but its start epoch is
// earlier, which is what keeps the flamegraph properly nested.
function _push(label, durMs, depth, meta, tsEpochMs) {
    _registerExitHook();
    _buffer.push({
        label,
        durMs,
        depth,
        tsEpochMs: tsEpochMs === undefined ? Date.now() : tsEpochMs,
        meta: meta === undefined ? undefined : meta,
    });
}

// span(label, fn, meta): time fn (sync or async) with performance.now() and
// record a nested span. When profiling is off, this is a pure pass-through of
// fn() with zero recording overhead.
export function span(label, fn, meta) {
    if (!isOn()) {
        return fn();
    }
    const depth = _depth;
    _depth = depth + 1;
    const start = performance.now();
    const startEpoch = Date.now();

    const finish = () => {
        _depth = depth;
        _push(label, performance.now() - start, depth, meta, startEpoch);
    };

    let result;
    try {
        result = fn();
    } catch (err) {
        finish();
        throw err;
    }

    if (result && typeof result.then === 'function') {
        return result.then(
            (value) => {
                finish();
                return value;
            },
            (err) => {
                finish();
                throw err;
            },
        );
    }

    finish();
    return result;
}

// mark(label): capture a start time, returning an opaque token. Null when off.
export function mark(label) {
    if (!isOn()) return null;
    return { label, start: performance.now(), startEpoch: Date.now(), depth: _depth };
}

// measure(token, meta): close a mark() token and record the span. No-op on null.
export function measure(token, meta) {
    if (!token) return;
    _push(token.label, performance.now() - token.start, token.depth, meta, token.startEpoch);
}

// record(name, durMs, meta): record a precomputed duration event (for
// cross-await or subprocess timings that don't fit the span() lifecycle).
export function record(name, durMs, meta) {
    if (!isOn()) return;
    _push(name, durMs, _depth, meta);
}

// setRunMeta(meta): shallow-merge meta into this process's run metadata.
export function setRunMeta(meta) {
    if (!meta || typeof meta !== 'object') return;
    _runMeta = { ..._runMeta, ...meta };
}

// flush(): append every buffered span/event as JSONL to
// <dir>/spans-<pid>.jsonl, then clear the buffer. Idempotent.
export function flush() {
    if (_buffer.length === 0) return;

    const dir = process.env.WBDC_PROFILE_DIR || path.join('reports', 'profile');
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `spans-${process.pid}.jsonl`);
    const pid = process.pid;
    const run = _runMeta;

    const lines = _buffer.map((s) =>
        JSON.stringify({
            pid,
            run,
            label: s.label,
            durMs: s.durMs,
            depth: s.depth,
            tsEpochMs: s.tsEpochMs,
            meta: s.meta,
        }),
    );

    fs.appendFileSync(file, lines.join('\n') + '\n');
    _buffer.length = 0;
}

// toSpeedscope(spans): PURE function. Convert recorded spans into a speedscope
// file-format object (https://www.speedscope.app). Each span becomes an
// open ("O") event at its start and a close ("C") event at start + durMs, in a
// single evented profile. Frames are de-duplicated by label.
export function toSpeedscope(spans) {
    const list = Array.isArray(spans) ? spans : [];

    const frames = [];
    const frameIndex = new Map();
    const frameFor = (label) => {
        const key = String(label);
        if (frameIndex.has(key)) return frameIndex.get(key);
        const index = frames.length;
        frames.push({ name: key });
        frameIndex.set(key, index);
        return index;
    };

    // Derive a monotonic "at" axis from each span's tsEpochMs, falling back to a
    // running cursor so spans without timestamps still nest in recorded order.
    // Each span yields two endpoints (open at start, close at end) carrying a
    // stable sequence id so opens/closes can be paired and ordered deterministically.
    let cursor = 0;
    const endpoints = [];
    let startValue = Infinity;
    let endValue = 0;

    list.forEach((s, seq) => {
        const dur = Number.isFinite(s && s.durMs) ? s.durMs : 0;
        const at = Number.isFinite(s && s.tsEpochMs) ? s.tsEpochMs : cursor;
        const depth = Number.isFinite(s && s.depth) ? s.depth : 0;
        const frame = frameFor(s && s.label);
        const end = at + dur;
        endpoints.push({ kind: 'O', at, frame, seq, depth });
        endpoints.push({ kind: 'C', at: end, frame, seq, depth });
        if (at < startValue) startValue = at;
        if (end > endValue) endValue = end;
        cursor = end;
    });

    if (!Number.isFinite(startValue)) startValue = 0;

    // Speedscope evented profiles require chronologically ordered events where
    // every "O" is matched by a later "C" and frames close in reverse open order
    // (proper nesting). Date.now() has only millisecond resolution, so a parent
    // span and its sub-millisecond children frequently share the same `at`; we
    // therefore break ties by depth (which the span() recorder tracks) so the
    // flamegraph nests correctly regardless of record order:
    //   - same instant: opens (rank 0) before closes (rank 1)
    //   - among opens at that instant: shallower depth opens first (parent → child)
    //   - among closes at that instant: deeper depth closes first (child → parent)
    //   - remaining ties fall back to recording sequence for determinism
    endpoints.sort((a, b) => {
        if (a.at !== b.at) return a.at - b.at;
        const ra = a.kind === 'O' ? 0 : 1;
        const rb = b.kind === 'O' ? 0 : 1;
        if (ra !== rb) return ra - rb;
        if (a.kind === 'O') {
            if (a.depth !== b.depth) return a.depth - b.depth; // parent opens first
            return a.seq - b.seq;
        }
        if (a.depth !== b.depth) return b.depth - a.depth; // child closes first
        return b.seq - a.seq;
    });

    const events = endpoints.map((e) => ({ type: e.kind, at: e.at, frame: e.frame }));

    return {
        $schema: 'https://www.speedscope.app/file-format-schema.json',
        shared: { frames },
        profiles: [
            {
                type: 'evented',
                name: 'wbdc-profile',
                unit: 'milliseconds',
                startValue,
                endValue,
                events,
            },
        ],
    };
}
