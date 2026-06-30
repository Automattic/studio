//
// Parity log
// ==========
// A replayable, per-page record of the SEMANTIC steps taken to reach visual
// parity. Each entry captures a divergence observed by LOOKING at the source vs
// the built band, the source target, and the fix — NOT a literal markup diff
// (those break when a reconstruction changes structure). `match-page` writes this
// as it polishes; a replay re-applies each entry to a freshly-reconstructed build
// (re-grounding on the source crop), so manual parity work survives a reconstruct
// without being frozen. Recurring entries are the backlog of rules to promote
// into the extractor/emitter (`promoteToEmitter`), after which they leave the log.
//
// Pure: parse/serialize/upsert only. File I/O lives in the caller (the skill
// writes/reads the JSON, or a thin loader).
//

export type ParityAxis =
  | 'structure'
  | 'spacing'
  | 'full-bleed'
  | 'radius'
  | 'color'
  | 'type-size'
  | 'line-height'
  | 'font-family'
  | 'dim'
  | 'media'
  | 'alignment'
  | 'chrome';

export type ParityStatus = 'applied' | 'residual' | 'pending';

export interface ParityLogEntry {
  /** Human-readable band label, e.g. "services", "journey". */
  band: string;
  /** Section index the entry targets (the replay key, with `axes`). */
  bandIndex: number;
  /** What was observed wrong, from LOOKING at source vs built. */
  divergence: string;
  /** What the source actually shows — the goal to re-derive against. */
  sourceTarget: string;
  /** The semantic fix applied (NOT a literal markup diff). */
  fix: string;
  /** Which visual axes this entry touches (also the dedupe signature with band). */
  axes: ParityAxis[] | string[];
  status: ParityStatus;
  /** Backlog note: how to make this a deterministic extractor/emitter rule so it
   *  can graduate OUT of the log. Present when the divergence is a recurring,
   *  rule-shaped gap rather than a one-off visual quirk. */
  promoteToEmitter?: string;
  /** Paths (under output/<site>/) to the source + built evidence crops. */
  evidence?: { source?: string; built?: string };
}

export interface ParityLog {
  version: number;
  page: string;
  sourceUrl?: string;
  updatedAt?: string;
  entries: ParityLogEntry[];
}

const REQUIRED_ENTRY_KEYS: (keyof ParityLogEntry)[] = ['band', 'bandIndex', 'divergence', 'sourceTarget', 'fix', 'axes', 'status'];

/** Parse + VALIDATE a parity-log JSON string. Throws on a malformed log so a bad
 *  file can never silently drive a replay. */
export function parseParityLog(json: string): ParityLog {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('parity-log: not valid JSON');
  }
  if (!raw || typeof raw !== 'object') throw new Error('parity-log: not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'number') throw new Error('parity-log: missing/invalid version');
  if (typeof o.page !== 'string') throw new Error('parity-log: missing/invalid page');
  if (!Array.isArray(o.entries)) throw new Error('parity-log: entries must be an array');
  for (const e of o.entries as unknown[]) {
    if (!e || typeof e !== 'object') throw new Error('parity-log: entry not an object');
    const en = e as Record<string, unknown>;
    for (const k of REQUIRED_ENTRY_KEYS) {
      if (en[k] === undefined) throw new Error(`parity-log: entry missing "${k}"`);
    }
    if (!Array.isArray(en.axes)) throw new Error('parity-log: entry.axes must be an array');
  }
  return raw as ParityLog;
}

export function serializeParityLog(log: ParityLog): string {
  return JSON.stringify(log, null, 2);
}

/** Replace-or-append: an entry with the same (bandIndex, axes-set) REPLACES the
 *  existing one (re-polishing a band/axis updates in place); any other (band or
 *  axes) appends. Returns a new log (pure). */
export function upsertEntry(log: ParityLog, entry: ParityLogEntry): ParityLog {
  const sig = (e: ParityLogEntry) => `${e.bandIndex}::${[...e.axes].sort().join('|')}`;
  const key = sig(entry);
  let replaced = false;
  const entries = log.entries.map((e) => {
    if (sig(e) === key) {
      replaced = true;
      return entry;
    }
    return e;
  });
  if (!replaced) entries.push(entry);
  return { ...log, entries };
}

/** The entries a replay should re-apply: applied or residual (skip pending),
 *  ordered top-to-bottom by band index. */
export function replayableEntries(log: ParityLog): ParityLogEntry[] {
  return log.entries
    .filter((e) => e.status === 'applied' || e.status === 'residual')
    .sort((a, b) => a.bandIndex - b.bandIndex);
}
