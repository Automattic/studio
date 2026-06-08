import { describe, expect, it } from 'vitest';
import { evalSiteName, isDeletableEvalSite } from 'cli/ai/eval-wsg/safety';
import {
	analyzeCustomBlocks,
	checkExpectations,
	countBlocks,
	isInputCpt,
	parseScreenshotPaths,
	parseValidation,
	summarize,
	type CaseResult,
} from 'cli/ai/eval-wsg/scorecard';
import { parseSpec } from 'cli/ai/eval-wsg/specs';
import type { CompanionPluginPlan } from 'cli/ai/tools/site-generator/manifest';

function plugin( over: Partial< CompanionPluginPlan > = {} ): CompanionPluginPlan {
	return {
		needed: true,
		slug: 'site-functionality',
		name: 'Site Functionality',
		postTypes: [],
		restRoutes: [],
		blocks: [],
		...over,
	};
}

describe( 'safety', () => {
	it( 'only allows deleting wsg-eval-prefixed sites', () => {
		expect( isDeletableEvalSite( 'wsg-eval-ember-2026' ) ).toBe( true );
		expect( isDeletableEvalSite( 'wsg-eval-' ) ).toBe( false );
		expect( isDeletableEvalSite( 'my-real-site' ) ).toBe( false );
		expect( isDeletableEvalSite( '' ) ).toBe( false );
		expect( isDeletableEvalSite( undefined as unknown as string ) ).toBe( false );
	} );

	it( 'builds a prefixed, slugified site name', () => {
		expect( evalSiteName( 'Restaurant Reservations!', '2026-06-03T10-00-00-000Z' ) ).toBe(
			'wsg-eval-restaurant-reservations-2026-06-03t10-00-00-000z'
		);
		expect( evalSiteName( '', '' ) ).toBe( 'wsg-eval-case-run' );
	} );
} );

describe( 'countBlocks', () => {
	it( 'counts opening delimiters and ignores closing ones', () => {
		const html =
			'<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->' +
			'<!-- wp:html --><div></div><!-- /wp:html -->' +
			'<!-- wp:core/group --><!-- /wp:core/group -->';
		const counts = countBlocks( html );
		expect( counts.total ).toBe( 3 );
		expect( counts.wpHtml ).toBe( 1 );
		expect( counts.byType ).toEqual( { paragraph: 1, html: 1, 'core/group': 1 } );
	} );

	it( 'detects namespaced html blocks and empty content', () => {
		expect( countBlocks( '<!-- wp:core/html -->' ).wpHtml ).toBe( 1 );
		expect( countBlocks( '' ) ).toEqual( { total: 0, wpHtml: 0, byType: {} } );
	} );
} );

describe( 'parseValidation', () => {
	it( 'parses the N/M valid line', () => {
		expect( parseValidation( 'Validation: 42/42 blocks valid\nNo fixes needed.' ) ).toEqual( {
			valid: 42,
			total: 42,
		} );
		expect( parseValidation( 'Validation: 3 / 5 blocks valid' ) ).toEqual( { valid: 3, total: 5 } );
		expect( parseValidation( 'no validation line here' ) ).toBeNull();
	} );
} );

describe( 'parseScreenshotPaths', () => {
	it( 'reads a single payload', () => {
		const text =
			'Screenshot captured — desktop: full page.\n' +
			'mediaWidgetPayload={"type":"media","widgetProps":{"source":{"path":"/tmp/shot-desktop.jpeg"}}}';
		expect( parseScreenshotPaths( text ) ).toEqual( [ '/tmp/shot-desktop.jpeg' ] );
	} );

	it( 'reads multiple payloads', () => {
		const text =
			'Screenshots captured:\n- desktop\n- mobile\n' +
			'mediaWidgetPayloads=[{"widgetProps":{"source":{"path":"/tmp/a.jpeg"}}},{"widgetProps":{"source":{"path":"/tmp/b.jpeg"}}}]';
		expect( parseScreenshotPaths( text ) ).toEqual( [ '/tmp/a.jpeg', '/tmp/b.jpeg' ] );
	} );

	it( 'returns empty on malformed or missing payloads', () => {
		expect( parseScreenshotPaths( 'mediaWidgetPayload=not json' ) ).toEqual( [] );
		expect( parseScreenshotPaths( 'no payload line' ) ).toEqual( [] );
	} );
} );

describe( 'isInputCpt', () => {
	it( 'flags input-bearing CPTs by keyword', () => {
		expect( isInputCpt( 'reservation' ) ).toBe( true );
		expect( isInputCpt( 'Booking' ) ).toBe( true );
		expect( isInputCpt( 'contact-submission' ) ).toBe( true );
		expect( isInputCpt( 'dish' ) ).toBe( false );
		expect( isInputCpt( 'roast' ) ).toBe( false );
	} );
} );

describe( 'analyzeCustomBlocks', () => {
	it( 'reports planned vs generated and missing', () => {
		const analysis = analyzeCustomBlocks(
			plugin( {
				blocks: [
					{ slug: 'reservation-form', title: 'Reservation Form', purpose: 'booking' },
					{ slug: 'menu-grid', title: 'Menu Grid', purpose: 'menu' },
				],
			} ),
			[ 'reservation-form' ]
		);
		expect( analysis.planned ).toEqual( [ 'reservation-form', 'menu-grid' ] );
		expect( analysis.generated ).toEqual( [ 'reservation-form' ] );
		expect( analysis.missing ).toEqual( [ 'menu-grid' ] );
	} );

	it( 'flags an input CPT with no related block', () => {
		const analysis = analyzeCustomBlocks(
			plugin( { postTypes: [ { slug: 'booking', name: 'Booking', fields: [] } ] } ),
			[]
		);
		expect( analysis.inputCpts ).toEqual( [ 'booking' ] );
		expect( analysis.inputCptsWithoutBlock ).toEqual( [ 'booking' ] );
	} );

	it( 'treats a form block as covering an input CPT', () => {
		const analysis = analyzeCustomBlocks(
			plugin( { postTypes: [ { slug: 'inquiry', name: 'Inquiry', fields: [] } ] } ),
			[ 'contact-form' ]
		);
		expect( analysis.inputCptsWithoutBlock ).toEqual( [] );
	} );
} );

describe( 'checkExpectations', () => {
	it( 'returns no failures when expectations are met', () => {
		const failures = checkExpectations(
			{ needsCompanionPlugin: true, minPages: 4, minCustomBlocks: 1, inputCptsNeedBlock: true },
			{
				manifest: {
					themeSlug: 'x',
					layoutMode: 'landing-page',
					contentMode: 'homepage-and-pages',
					pages: 5,
					needsCompanionPlugin: true,
					plannedBlocks: [ 'reservation-form' ],
					postTypes: [ 'reservation' ],
					restRoutes: [],
				},
				customBlocks: {
					planned: [ 'reservation-form' ],
					generated: [ 'reservation-form' ],
					missing: [],
					inputCpts: [ 'reservation' ],
					inputCptsWithoutBlock: [],
				},
			}
		);
		expect( failures ).toEqual( [] );
	} );

	it( 'reports each unmet expectation', () => {
		const failures = checkExpectations(
			{ needsCompanionPlugin: true, minPages: 4, minCustomBlocks: 1, inputCptsNeedBlock: true },
			{
				manifest: {
					themeSlug: 'x',
					layoutMode: 'vertical-stack',
					contentMode: 'homepage-and-pages',
					pages: 2,
					needsCompanionPlugin: false,
					plannedBlocks: [],
					postTypes: [ 'booking' ],
					restRoutes: [],
				},
				customBlocks: {
					planned: [],
					generated: [],
					missing: [],
					inputCpts: [ 'booking' ],
					inputCptsWithoutBlock: [ 'booking' ],
				},
			}
		);
		expect( failures ).toHaveLength( 4 );
	} );

	it( 'returns no failures when there are no expectations', () => {
		expect( checkExpectations( undefined, {} ) ).toEqual( [] );
	} );
} );

describe( 'summarize', () => {
	it( 'aggregates pass/fail counts and average stage timings', () => {
		const cases: CaseResult[] = [
			{
				caseId: 'a',
				siteName: 'wsg-eval-a',
				ok: true,
				stageTimingsMs: { theme: 100, seed: 200 },
				coreBlocks: { byFile: {}, totalBlocks: 40, totalWpHtml: 0 },
				errors: [],
			},
			{
				caseId: 'b',
				siteName: 'wsg-eval-b',
				ok: false,
				stageTimingsMs: { theme: 300, seed: 400 },
				errors: [ { stage: 'seed', message: 'boom' } ],
			},
		];
		const summary = summarize( 'run-1', cases );
		expect( summary.total ).toBe( 2 );
		expect( summary.passed ).toBe( 1 );
		expect( summary.failed ).toBe( 1 );
		expect( summary.avgStageTimingsMs ).toEqual( { theme: 200, seed: 300 } );
	} );
} );

describe( 'parseSpec', () => {
	it( 'parses a valid spec', () => {
		const spec = parseSpec(
			{ caseId: 'x', spec: { name: 'Site' }, expects: { minPages: 2 } },
			'x.json'
		);
		expect( spec.caseId ).toBe( 'x' );
		expect( spec.spec.name ).toBe( 'Site' );
		expect( spec.expects ).toEqual( { minPages: 2 } );
	} );

	it( 'throws on a missing caseId, spec, or spec.name', () => {
		expect( () => parseSpec( { spec: { name: 'x' } }, 'a' ) ).toThrow( /caseId/ );
		expect( () => parseSpec( { caseId: 'x' }, 'b' ) ).toThrow( /spec/ );
		expect( () => parseSpec( { caseId: 'x', spec: {} }, 'c' ) ).toThrow( /name/ );
	} );
} );
