import { runInNewContext } from 'node:vm';
import { DATA_MODEL_SCHEMA, type DataModel, type DataField, type DataItem, type MountSpec } from './types.js';
import { validateDataModel } from './validate-model.js';
import { discoverHtmlCards } from './discover-html-cards.js';
import {
  discoverDataArrays,
  discoverIdLookups,
  discoverMounts,
  parseProgram,
  walk,
  type Confidence,
  type DiscoveredArray,
  type DiscoveredMount,
} from './discover-js-data.js';
import { inferFields } from './infer-fields.js';
import type { DiscoveredArrayInfo, ScaffoldResult, ScaffoldTodo } from './scaffold-types.js';
import { syntheticCardAnchor } from './synthetic-anchor.js';

export interface ScaffoldInput {
  html: string;
  htmlFiles?: Array<{ name: string; text: string }>;
  js: string;
  skippedFiles?: string[];
  /** Resolve a card link href → linked local page HTML (handler-injected). */
  resolvePage?: (href: string) => string | null;
}

const MAX_FALLBACK_ARRAY_CHARS = 200_000;
const MAX_RECORDS = 5_000;

const slugify = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const singular = (value: string): string => value.replace(/s$/i, '');
const titleCase = (value: string): string => value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()).trim();
const scalar = (value: unknown): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value);
const NEWEST_STYLE_SIGNALS = ['newest', 'recent', 'latest'];
const taxonomySlugFor = (corePost: boolean, cptSlug: string): string => corePost ? 'category' : `${cptSlug}_cat`;

type BaseDiscovered = Omit<ScaffoldResult['discovered'], 'source'>;
type BuildMount = DiscoveredMount & Pick<MountSpec, 'sourceSelector' | 'sourcePage' | 'featured'>;

interface BuildModelFromRecordsOpts {
  records: Array<Record<string, unknown>>;
  typeName?: string;
  coreType?: 'post';
  mounts: BuildMount[];
  idLookupNames: string[];
  source: Extract<ScaffoldResult['discovered']['source'], 'js-array' | 'html-cards'>;
  cardTemplateTodoEvidence?: string;
  deterministicCard?: string;
  deterministicCardVariants?: Record<string, string>;
  discovered: BaseDiscovered;
  todos: ScaffoldTodo[];
}

export function scaffoldDataModel(input: ScaffoldInput): ScaffoldResult {
  const todos: ScaffoldTodo[] = [];
  const arrays = discoverScaffoldArrays(input.js);
  const idLookupNames = discoverIdLookups(input.js);
  const discoveredMounts = discoverMounts(input.html, input.js);
  const discoveredArrays: DiscoveredArrayInfo[] = arrays.map((array) => ({
    name: array.name,
    confidence: array.confidence,
    recordCount: array.records?.length,
    reason: array.confidence === 'low' ? array.evidence.slice(0, 120) : undefined,
  }));
  const discovered = {
    arrays: discoveredArrays,
    skippedFiles: input.skippedFiles ?? [],
    unmatchedContainers: discoveredMounts
      .filter((mount) => mount.confidence === 'low' || !mount.sourceCall)
      .map((mount) => mount.selector),
  };
  const primary = choosePrimaryArray(arrays, idLookupNames, discoveredMounts);

  if (primary?.records) {
    return buildModelFromRecords({
      records: primary.records,
      typeName: primary.name,
      mounts: discoveredMounts,
      idLookupNames,
      source: 'js-array',
      cardTemplateTodoEvidence: extractCardFn(input.js),
      deterministicCard: undefined,
      discovered,
      todos,
    });
  }

  const discoveredGrids = input.htmlFiles?.length
    ? input.htmlFiles.flatMap((file) =>
        discoverHtmlCards(file.text, { resolvePage: input.resolvePage }).map((grid, gi) => ({
          grid,
          disambiguator: `${file.name}:${gi}`,
          sourcePage: file.name,
        }))
      )
    : discoverHtmlCards(input.html, { resolvePage: input.resolvePage }).map((grid, i) => ({
        grid,
        disambiguator: String(i),
        sourcePage: undefined,
      }));
  const usableGrids = discoveredGrids.filter(({ grid }) => grid.records.length >= 1);
  if (usableGrids.length > 0) {
    const records = dedupeRecordsById(usableGrids.flatMap(({ grid }) => grid.records));
    const firstFeaturedGrid = usableGrids.find(({ grid }) => grid.featured);
    const htmlCardsTaxonomySlug = taxonomySlugFor(true, 'post');
    const cardMounts: BuildMount[] = usableGrids.map(({ grid, disambiguator, sourcePage }) => ({
      selector: `#${syntheticCardAnchor(grid.containerSelector, disambiguator)}`,
      sourceSelector: grid.containerSelector,
      ...(sourcePage ? { sourcePage } : {}),
      sourceCall: `html-cards:${grid.containerSelector}`,
      // Carry the source grid container's class onto the query loop's
      // post-template so the carried layout CSS keeps the cards in a grid
      // (without it the post-template falls back to vertical flow).
      ...(grid.containerClass ? { wrapperClass: grid.containerClass } : {}),
      // perPage = the number of cards baked into THIS source grid, so the query
      // loop renders the same count page-1 as the source (a curated 5-card
      // "featured" strip and a 9-card index grid stay distinct). Without it
      // every loop defaults to -1 (all posts), so each grid renders the full
      // pool — the page balloons to several times the source height and the
      // structure misaligns from the first grid down (baseplate: 13365px vs
      // the source's 3104px). Ordering stays document-order (see orderForMount).
      perPageHint: grid.records.length,
      ...(grid.featured ? {
        featured: {
          columnWrapperClass: grid.featured.columnWrapperClass,
          leadPerPage: grid.featured.leadCount,
          columnPerPage: grid.records.length - grid.featured.leadCount,
          variant: 'row',
          ...(grid.featured.termSlug ? { termSlug: grid.featured.termSlug, taxonomy: htmlCardsTaxonomySlug } : {}),
        },
      } : {}),
      confidence: 'high',
      evidence: grid.evidence,
    }));
    return buildModelFromRecords({
      records,
      coreType: 'post',
      mounts: cardMounts,
      idLookupNames: [],
      source: 'html-cards',
      cardTemplateTodoEvidence: undefined,
      deterministicCard: usableGrids[0].grid.cardTemplate,
      deterministicCardVariants: firstFeaturedGrid?.grid.featured ? { row: firstFeaturedGrid.grid.featured.rowTemplate } : undefined,
      discovered: {
        ...discovered,
        unmatchedContainers: discoveredGrids.filter(({ grid }) => grid.records.length === 0).map(({ grid }) => grid.containerSelector),
      },
      todos,
    });
  }

  const empty = emptyModel();
  todos.push({
    path: 'items',
    instruction: 'No static data array literal and no repeated content-card grid were found. Author items[] and the model by hand from the source.',
    evidence: arrays[0]?.evidence ?? '(no array-like declarations or card grids found)',
  });
  return { model: empty, skillTodos: todos, discovered: { ...discovered, source: 'none' }, validation: validateDataModel(empty) };
}

function buildModelFromRecords(opts: BuildModelFromRecordsOpts): ScaffoldResult {
  const { records, todos } = opts;
  const corePost = opts.coreType === 'post';
  const inferredBase = inferFields(records);
  const inferred = corePost && records.some((record) => Object.prototype.hasOwnProperty.call(record, 'content'))
    ? {
        ...inferredBase,
        contentKey: 'content',
        fields: fieldsWithRestoredContentMeta(records, inferredBase).filter((field) => field.key !== 'content'),
      }
    : inferredBase;
  const sourceName = opts.typeName ?? 'item';
  const typeNoun = singular(sourceName === '(anonymous)' ? 'item' : sourceName).toLowerCase();
  const cptSlug = corePost ? 'post' : slugify(typeNoun) || 'item';
  const taxonomySlug = taxonomySlugFor(corePost, cptSlug);

  const termSet = new Map<string, string>();
  if (inferred.termKey) {
    for (const record of records) {
      const termValue = record[inferred.termKey];
      if (typeof termValue === 'string') termSet.set(slugify(termValue), titleCase(termValue));
    }
  }

  const items: DataItem[] = records.map((record) => {
    const meta: Record<string, string | number | boolean> = {};
    for (const field of inferred.fields) {
      const value = record[field.key];
      if (scalar(value)) meta[field.key] = value;
    }

    const galleryRaw = inferred.galleryKey ? record[inferred.galleryKey] : undefined;
    const gallery = Array.isArray(galleryRaw)
      ? galleryRaw.map((entry) => {
          if (typeof entry === 'string') return { caption: entry };
          const image = entry as { caption?: unknown; url?: string };
          return { caption: String(image.caption ?? ''), url: image.url };
        })
      : [];
    const termValue = inferred.termKey ? record[inferred.termKey] : undefined;
    const idValue = record[inferred.idKey];

    return {
      id: scalar(idValue) ? String(idValue) : '',
      title: String(record[inferred.titleKey] ?? ''),
      terms: typeof termValue === 'string' ? [slugify(termValue)] : [],
      meta,
      gallery,
      content: inferred.contentKey ? String(record[inferred.contentKey] ?? '') : undefined,
    };
  });

  const mounts: MountSpec[] = [];
  for (const mount of opts.mounts) {
    if (mount.confidence !== 'high' || !mount.sourceCall) continue;
    const index = mounts.length;
    const perPage = mount.perPageHint ?? -1;
    const orderDecision = orderForMount(mount, perPage);
    if (orderDecision.confidence === 'low') {
      todos.push({
        path: `mounts[${index}].query.order`,
        instruction: `Confirm ordering/perPage for ${mount.selector}; source call: "${mount.sourceCall}". Default applied: date/DESC. Adjust to match the source's selection semantics.`,
        evidence: mount.evidence,
      });
    }
    mounts.push({
      selector: mount.selector,
      sourceCall: mount.sourceCall,
      query: { postType: cptSlug, perPage, orderBy: 'date', order: orderDecision.order },
      wrapperClass: mount.wrapperClass,
      ...(mount.sourceSelector ? { sourceSelector: mount.sourceSelector } : {}),
      ...(mount.sourcePage ? { sourcePage: mount.sourcePage } : {}),
      ...(mount.featured ? { featured: mount.featured } : {}),
    });
  }

  if (opts.cardTemplateTodoEvidence) {
    todos.unshift({
      path: 'card.template',
      instruction: 'Author card.template: rewrite the source per-item card function into a single-root skeleton with data-dla-* bindings (data-dla-text/attr/class/if), preserving the source classes. Reference: id, title, content, cat.slug, cat.label, meta.<key>, gallery.<n>.caption, map.<name>.<expr>. Add any value-keyed lookups to card.maps.',
      evidence: opts.cardTemplateTodoEvidence,
    });
  }

  if (inferred.confidence.id === 'low') {
    todos.push({
      path: 'items[].id',
      instruction: `The id field was guessed ('${inferred.idKey}') and may be non-unique or non-scalar; confirm/choose the stable per-item id (it is the idempotency key for inserts).`,
      evidence: `record keys: ${Object.keys(records[0] ?? {}).join(', ')}`,
    });
  }
  if (inferred.confidence.title === 'low') {
    todos.push({
      path: 'items[].title',
      instruction: `Title was guessed ('${inferred.titleKey}') with no name match; confirm it is the human title.`,
      evidence: `record keys: ${Object.keys(records[0] ?? {}).join(', ')}`,
    });
  }
  if (inferred.confidence.terms === 'low' && inferred.termKey) {
    todos.push({
      path: 'taxonomy',
      instruction: `Taxonomy column was guessed ('${inferred.termKey}') by low cardinality; confirm it is a content category.`,
      evidence: `distinct: ${[...termSet.keys()].join(', ')}`,
    });
  }

  const model: DataModel = {
    cpt: corePost
      ? { slug: 'post', singular: 'Post', plural: 'Posts', public: true, supports: ['title', 'editor', 'thumbnail', 'custom-fields'] }
      : {
          slug: cptSlug,
          singular: titleCase(typeNoun),
          plural: titleCase((sourceName === '(anonymous)' ? 'items' : sourceName).toLowerCase()),
          public: true,
          supports: ['title', 'editor', 'custom-fields'],
        },
    taxonomy: {
      slug: taxonomySlug,
      label: 'Categories',
      hierarchical: true,
      terms: [...termSet].map(([slug, label]) => ({ slug, label })),
    },
    fields: inferred.fields,
    items,
    mounts,
    card: { template: opts.deterministicCard ?? '', maps: {}, ...(opts.deterministicCardVariants ? { variants: opts.deterministicCardVariants } : {}) },
    sourceArrays: corePost ? [] : [...new Set([...opts.idLookupNames, sourceName].filter((name) => name && name !== '(anonymous)'))],
    schema: DATA_MODEL_SCHEMA,
  };

  return { model, skillTodos: todos, discovered: { ...opts.discovered, source: opts.source }, validation: validateDataModel(model) };
}

function dedupeRecordsById(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  const out: Array<Record<string, unknown>> = [];
  for (const record of records) {
    const id = record.id;
    if (typeof id === 'string' && id) {
      const kept = seen.get(id);
      if (kept) {
        const keptTitle = recordTitle(kept);
        const droppedTitle = recordTitle(record);
        if (keptTitle !== droppedTitle) {
          console.warn(`[local-data] dropping duplicate card id "${id}" (title "${droppedTitle}") - shared id/idempotency key`);
        }
        continue;
      }
      seen.set(id, record);
    }
    out.push(record);
  }
  return out;
}

function recordTitle(record: Record<string, unknown>): string {
  const title = record.title;
  return title == null ? '' : String(title);
}

function fieldsWithRestoredContentMeta(records: Array<Record<string, unknown>>, inferred: ReturnType<typeof inferFields>): DataField[] {
  const fields = [...inferred.fields];
  if (inferred.contentKey && inferred.contentKey !== 'content' && !fields.some((field) => field.key === inferred.contentKey)) {
    fields.push(dataFieldForKey(records, inferred.contentKey));
  }
  const keyOrder = new Map(recordKeys(records).map((key, index) => [key, index] as const));
  return fields.sort((a, b) => (keyOrder.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (keyOrder.get(b.key) ?? Number.MAX_SAFE_INTEGER));
}

function recordKeys(records: Array<Record<string, unknown>>): string[] {
  return [...new Set(records.flatMap((record) => Object.keys(record)))];
}

function dataFieldForKey(records: Array<Record<string, unknown>>, key: string): DataField {
  const fieldValues = records.map((record) => record[key]).filter((value) => value !== undefined);
  if (fieldValues.length > 0 && fieldValues.every((value) => typeof value === 'boolean')) return { key, type: 'boolean' };
  if (fieldValues.length > 0 && fieldValues.every((value) => typeof value === 'number')) {
    return { key, type: fieldValues.every((value) => Number.isInteger(value)) ? 'integer' : 'number' };
  }
  const stringValues = fieldValues.filter((value) => typeof value === 'string') as string[];
  if (stringValues.length > 0 && stringValues.every((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))) return { key, type: 'string', format: 'email' };
  if (stringValues.length > 0 && stringValues.every((value) => /^https?:\/\//.test(value))) return { key, type: 'string', format: 'url' };
  if (stringValues.length > 0 && stringValues.every((value) => /^\d{4}-\d{2}-\d{2}/.test(value))) return { key, type: 'string', format: 'date' };
  if (stringValues.some((value) => value.length >= 60)) return { key, type: 'string', format: 'textarea' };
  return { key, type: 'string' };
}

function choosePrimaryArray(
  arrays: DiscoveredArray[],
  idLookupNames: string[],
  mounts: DiscoveredMount[]
): DiscoveredArray | undefined {
  const candidates = arrays.filter((array) => array.records?.length);
  if (candidates.length === 0) return undefined;

  const idLookupSet = new Set(idLookupNames);
  const byIdLookup = candidates.find((array) => idLookupSet.has(array.name));
  if (byIdLookup) return byIdLookup;

  const sourceCalls = mounts.map((mount) => mount.sourceCall).filter((sourceCall): sourceCall is string => Boolean(sourceCall));
  const byMountSource = candidates.find((array) => sourceCalls.some((sourceCall) => containsIdentifier(sourceCall, array.name)));
  if (byMountSource) return byMountSource;

  return candidates.reduce((best, array) => ((array.records?.length ?? 0) > (best.records?.length ?? 0) ? array : best));
}

function containsIdentifier(source: string, identifier: string): boolean {
  if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) return false;
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}($|[^A-Za-z0-9_$])`).test(source);
}

function orderForMount(mount: DiscoveredMount, perPage: number): { order: NonNullable<MountSpec['query']['order']>; confidence: Confidence } {
  // Static HTML cards are baked into the page in document order; the query loop
  // preserves that order (ASC by insertion). perPageHint here constrains the
  // COUNT only — it must not flip these mounts to date-DESC (which would reorder
  // the cards against the source and emit a spurious low-confidence order todo).
  if (mount.sourceCall?.startsWith('html-cards:')) return { order: 'ASC', confidence: 'high' };
  if (mount.perPageHint === undefined || perPage === -1) return { order: 'ASC', confidence: 'high' };
  if (hasNewestStyleSignal(mount.sourceCall ?? '')) return { order: 'DESC', confidence: 'high' };
  return { order: 'DESC', confidence: 'low' };
}

function hasNewestStyleSignal(sourceCall: string): boolean {
  const tokens = sourceCall.match(/[A-Za-z][A-Za-z0-9_$]*/g) ?? [];
  return tokens.some((token) => NEWEST_STYLE_SIGNALS.some((signal) => tokenHasOrderSignal(token, signal)));
}

function tokenHasOrderSignal(token: string, signal: string): boolean {
  const lower = token.toLowerCase();
  if (lower === signal) return true;
  if (!lower.startsWith(signal)) return false;
  const next = token[signal.length];
  return Boolean(next && /[A-Z0-9_$]/.test(next));
}

function emptyModel(): DataModel {
  return {
    cpt: { slug: 'item', singular: 'Item', plural: 'Items', public: true, supports: ['title', 'editor', 'custom-fields'] },
    taxonomy: { slug: 'item_cat', label: 'Categories', hierarchical: true, terms: [] },
    fields: [],
    items: [],
    mounts: [],
    card: { template: '', maps: {} },
    sourceArrays: [],
    schema: DATA_MODEL_SCHEMA,
  };
}

function discoverScaffoldArrays(js: string): DiscoveredArray[] {
  const strictArrays = discoverDataArrays(js);
  if (strictArrays.some((array) => array.records?.length)) return strictArrays;
  return [...strictArrays, ...discoverStaticObjectArrays(js, strictArrays)];
}

function discoverStaticObjectArrays(js: string, existing: DiscoveredArray[]): DiscoveredArray[] {
  const ast = parseProgram(js);
  if (!ast) return [];
  const existingEvidence = new Set(existing.map((array) => array.evidence));
  const arrays: DiscoveredArray[] = [];
  const seen = new Set<number>();

  const consider = (node: any, name: string): void => {
    if (!looksLikeObjectArray(node) || seen.has(node.start)) return;
    seen.add(node.start);
    const evidence = evidenceFor(js, node);
    if (existingEvidence.has(evidence)) return;
    const evaluated = evalStaticArray(js, node, evidence);
    arrays.push({ name, ...evaluated });
  };

  walk(ast, (node: any) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') consider(node.init, node.id.name);
    if (node.type === 'AssignmentExpression') {
      const left = node.left;
      const hint = left?.type === 'Identifier' ? left.name : left?.property?.name;
      consider(node.right, hint ?? '(anonymous)');
    }
    if (node.type === 'Property') consider(node.value, String(node.key?.name ?? node.key?.value ?? '(anonymous)'));
  });

  return arrays;
}

function looksLikeObjectArray(node: any): boolean {
  return Boolean(
    node?.type === 'ArrayExpression' &&
      node.elements?.length > 0 &&
      node.elements.every((element: any) => element?.type === 'ObjectExpression')
  );
}

function isStaticLiteral(node: any): boolean {
  if (!node) return false;
  if (node.type === 'Literal') return true;
  if (node.type === 'ArrayExpression') return (node.elements ?? []).every((element: any) => element === null || isStaticLiteral(element));
  if (node.type === 'ObjectExpression') {
    return (node.properties ?? []).every((property: any) => {
      if (!property || property.type !== 'Property' || property.kind !== 'init' || property.method || property.shorthand) return false;
      if (property.computed && !isStaticLiteral(property.key)) return false;
      return isStaticLiteral(property.value);
    });
  }
  if (node.type === 'UnaryExpression' && ['-', '+', '!', '~'].includes(node.operator)) return isStaticLiteral(node.argument);
  if (node.type === 'TemplateLiteral') return (node.expressions ?? []).length === 0;
  return false;
}

function evalStaticArray(
  js: string,
  node: any,
  evidence: string
): Pick<DiscoveredArray, 'records' | 'confidence' | 'evidence'> {
  const slice = js.slice(node.start, node.end);
  if (slice.length > MAX_FALLBACK_ARRAY_CHARS) return { confidence: 'low', evidence: `literal too large (${slice.length} chars) :: ${evidence}` };
  if (!isStaticLiteral(node)) return { confidence: 'low', evidence };
  try {
    const records = runInNewContext(`(${slice})`, Object.create(null), { timeout: 1000 }) as Array<Record<string, unknown>>;
    if (!Array.isArray(records) || records.length > MAX_RECORDS) return { confidence: 'low', evidence };
    return { records, confidence: 'high', evidence };
  } catch (error) {
    return { confidence: 'low', evidence: `${(error as Error).message} :: ${evidence}` };
  }
}

function evidenceFor(js: string, node: any): string {
  const slice = js.slice(node.start, node.end);
  return slice.length > 400 ? `${slice.slice(0, 400)}...` : slice;
}

function extractCardFn(js: string): string {
  const match = js.match(/function\s+\w*[Cc]ard\s*\([^)]*\)\s*\{[\s\S]*?\}/);
  if (!match) return '(no *Card function found; author from the rendered card markup)';
  return match[0].length > 600 ? `${match[0].slice(0, 600)}...` : match[0];
}
