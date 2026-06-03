import type { CompanionPluginPlan } from 'cli/ai/generation/manifest';

/**
 * Pure scorecard helpers for the WSG eval harness. Everything here is
 * deterministic and unit-tested; the impure orchestration in `pipeline.ts`
 * feeds these the raw strings/files and assembles the result objects.
 */

export interface BlockCounts {
	total: number;
	wpHtml: number;
	byType: Record< string, number >;
}

// Matches an OPENING block delimiter only. Closing delimiters are `<!-- /wp:…`
// (a slash sits between `<!--` and `wp:`), so they never match.
const OPEN_BLOCK_RE = /<!--\s*wp:([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?)/gi;

export function countBlocks( html: string ): BlockCounts {
	const byType: Record< string, number > = {};
	let total = 0;
	let wpHtml = 0;
	for ( const match of html.matchAll( OPEN_BLOCK_RE ) ) {
		const name = match[ 1 ].toLowerCase();
		total += 1;
		byType[ name ] = ( byType[ name ] ?? 0 ) + 1;
		if ( name === 'html' || name.endsWith( '/html' ) ) {
			wpHtml += 1;
		}
	}
	return { total, wpHtml, byType };
}

export function parseValidation( text: string ): { valid: number; total: number } | null {
	const match = text.match( /Validation:\s*(\d+)\s*\/\s*(\d+)\s*blocks valid/i );
	if ( ! match ) {
		return null;
	}
	return { valid: Number.parseInt( match[ 1 ], 10 ), total: Number.parseInt( match[ 2 ], 10 ) };
}

/**
 * Pulls saved screenshot file paths out of a `take_screenshot` text result.
 * The tool ends its text with `mediaWidgetPayload={…}` (single viewport) or
 * `mediaWidgetPayloads=[…]` (viewport "all"); each payload carries
 * `widgetProps.source.path`.
 */
export function parseScreenshotPaths( text: string ): string[] {
	const line = text
		.split( '\n' )
		.find(
			( l ) => l.startsWith( 'mediaWidgetPayloads=' ) || l.startsWith( 'mediaWidgetPayload=' )
		);
	if ( ! line ) {
		return [];
	}
	const json = line.slice( line.indexOf( '=' ) + 1 );
	let parsed: unknown;
	try {
		parsed = JSON.parse( json );
	} catch {
		return [];
	}
	const payloads = Array.isArray( parsed ) ? parsed : [ parsed ];
	const paths: string[] = [];
	for ( const payload of payloads ) {
		const p = ( payload as { widgetProps?: { source?: { path?: unknown } } } )?.widgetProps?.source
			?.path;
		if ( typeof p === 'string' && p ) {
			paths.push( p );
		}
	}
	return paths;
}

// Keywords that mark a CPT as carrying user-submitted input — the kind Telex
// always pairs with a custom form/submission block. Used as a heuristic signal,
// not a hard rule.
const INPUT_CPT_KEYWORDS = [
	'contact',
	'book',
	'reserv',
	'submiss',
	'submit',
	'inquir',
	'enquir',
	'appoint',
	'signup',
	'sign-up',
	'rsvp',
	'message',
	'lead',
	'applicat',
	'order',
	'request',
	'review',
	'testimonial',
];

export function isInputCpt( slugOrName: string ): boolean {
	const v = slugOrName.toLowerCase();
	return INPUT_CPT_KEYWORDS.some( ( kw ) => v.includes( kw ) );
}

export interface CustomBlockAnalysis {
	planned: string[];
	generated: string[];
	missing: string[];
	inputCpts: string[];
	inputCptsWithoutBlock: string[];
}

/**
 * Compares what the manifest planned against what landed on disk, and flags
 * input-CPTs (contact/booking/etc.) that have no plausibly-related custom
 * block. The CPT→block association is a keyword heuristic: a CPT is "covered"
 * if any generated block slug contains the CPT slug, a shared keyword, or a
 * generic form/submission token.
 */
export function analyzeCustomBlocks(
	plugin: CompanionPluginPlan,
	generatedBlockSlugs: string[]
): CustomBlockAnalysis {
	const planned = plugin.blocks.map( ( b ) => b.slug );
	const generated = [ ...generatedBlockSlugs ].sort();
	const missing = planned.filter( ( slug ) => ! generated.includes( slug ) );

	const inputCpts = plugin.postTypes
		.filter( ( pt ) => isInputCpt( pt.slug ) || isInputCpt( pt.name ) )
		.map( ( pt ) => pt.slug );

	const FORM_TOKENS = [
		'form',
		'contact',
		'book',
		'reserv',
		'submit',
		'submiss',
		'rsvp',
		'signup',
	];
	const inputCptsWithoutBlock = inputCpts.filter( ( cptSlug ) => {
		const covered = generated.some(
			( blockSlug ) =>
				blockSlug.includes( cptSlug ) ||
				cptSlug.split( '-' ).some( ( part ) => part.length > 3 && blockSlug.includes( part ) ) ||
				FORM_TOKENS.some( ( token ) => blockSlug.includes( token ) )
		);
		return ! covered;
	} );

	return { planned, generated, missing, inputCpts, inputCptsWithoutBlock };
}

export interface CaseResult {
	caseId: string;
	siteName: string;
	ok: boolean;
	stageTimingsMs: Record< string, number >;
	manifest?: {
		themeSlug: string;
		layoutMode: string;
		contentMode: string;
		pages: number;
		needsCompanionPlugin: boolean;
		plannedBlocks: string[];
		postTypes: string[];
		restRoutes: string[];
	};
	coreBlocks?: { byFile: Record< string, BlockCounts >; totalBlocks: number; totalWpHtml: number };
	customBlocks?: CustomBlockAnalysis;
	validation?: {
		byFile: Record< string, { valid: number; total: number } >;
		totalValid: number;
		totalBlocks: number;
	};
	screenshots?: string[];
	// Residual identifier-contract violations (a custom-block ref or Query Loop
	// postType that resolves to nothing registered) found in the generated theme
	// and seeded content after reconciliation. Non-empty means a render bug shipped.
	identifierViolations?: { file: string; type: string; ref: string }[];
	// Manifest CPT keys the generated plugin PHP does not register via
	// register_post_type — seeded entries under them would be orphaned.
	cptsNotRegistered?: string[];
	expectationsFailed?: string[];
	errors: { stage: string; message: string }[];
}

export interface EvalSummary {
	runId: string;
	total: number;
	passed: number;
	failed: number;
	cases: {
		caseId: string;
		ok: boolean;
		totalWpHtml: number;
		customBlocksGenerated: number;
		inputCptsWithoutBlock: number;
		identifierViolations: number;
		cptsNotRegistered: number;
		expectationsFailed: number;
		errors: number;
		totalMs: number;
	}[];
	avgStageTimingsMs: Record< string, number >;
}

export function summarize( runId: string, cases: CaseResult[] ): EvalSummary {
	const stageTotals: Record< string, { sum: number; n: number } > = {};
	for ( const c of cases ) {
		for ( const [ stage, ms ] of Object.entries( c.stageTimingsMs ) ) {
			const acc = ( stageTotals[ stage ] ??= { sum: 0, n: 0 } );
			acc.sum += ms;
			acc.n += 1;
		}
	}
	const avgStageTimingsMs: Record< string, number > = {};
	for ( const [ stage, { sum, n } ] of Object.entries( stageTotals ) ) {
		avgStageTimingsMs[ stage ] = n ? Math.round( sum / n ) : 0;
	}

	return {
		runId,
		total: cases.length,
		passed: cases.filter( ( c ) => c.ok ).length,
		failed: cases.filter( ( c ) => ! c.ok ).length,
		cases: cases.map( ( c ) => ( {
			caseId: c.caseId,
			ok: c.ok,
			totalWpHtml: c.coreBlocks?.totalWpHtml ?? 0,
			customBlocksGenerated: c.customBlocks?.generated.length ?? 0,
			inputCptsWithoutBlock: c.customBlocks?.inputCptsWithoutBlock.length ?? 0,
			identifierViolations: c.identifierViolations?.length ?? 0,
			cptsNotRegistered: c.cptsNotRegistered?.length ?? 0,
			expectationsFailed: c.expectationsFailed?.length ?? 0,
			errors: c.errors.length,
			totalMs: Object.values( c.stageTimingsMs ).reduce( ( a, b ) => a + b, 0 ),
		} ) ),
		avgStageTimingsMs,
	};
}

/**
 * Checks a case's measured output against the spec's declared expectations.
 * Returns a list of human-readable failure strings (empty = all satisfied).
 */
export function checkExpectations(
	expects: import('./specs').WsgExpectations | undefined,
	result: Pick< CaseResult, 'manifest' | 'customBlocks' >
): string[] {
	if ( ! expects ) {
		return [];
	}
	const failures: string[] = [];
	if ( expects.needsCompanionPlugin !== undefined && result.manifest ) {
		if ( result.manifest.needsCompanionPlugin !== expects.needsCompanionPlugin ) {
			failures.push(
				`expected needsCompanionPlugin=${ expects.needsCompanionPlugin }, got ${ result.manifest.needsCompanionPlugin }`
			);
		}
	}
	if ( expects.minPages !== undefined && result.manifest ) {
		if ( result.manifest.pages < expects.minPages ) {
			failures.push( `expected >= ${ expects.minPages } pages, got ${ result.manifest.pages }` );
		}
	}
	if ( expects.minCustomBlocks !== undefined ) {
		const generated = result.customBlocks?.generated.length ?? 0;
		if ( generated < expects.minCustomBlocks ) {
			failures.push(
				`expected >= ${ expects.minCustomBlocks } custom block(s), got ${ generated }`
			);
		}
	}
	if ( expects.inputCptsNeedBlock && result.customBlocks ) {
		if ( result.customBlocks.inputCptsWithoutBlock.length > 0 ) {
			failures.push(
				`input CPT(s) without a block: ${ result.customBlocks.inputCptsWithoutBlock.join( ', ' ) }`
			);
		}
	}
	return failures;
}
