import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchChromiumWithInstall } from 'cli/ai/browser-utils';
import {
	LAYOUT_BASELINE_SCHEMA,
	VISUAL_PARITY_COMPILER_REPORT_PATH,
	VISUAL_PARITY_STAGE,
	VISUAL_PARITY_VIEWPORT,
	buildVisualParityValidationArtifacts,
	loadCapturedRoutes,
	loadCapturedSectionPages,
	routeForCapturedPage,
	toVisualParityOraclePayload,
	visualParityGateFailure,
	type CapturedSectionPage,
	type VisualParityArtifacts,
	type VisualParityEvaluation,
} from 'cli/lib/visual-parity';

vi.mock( 'cli/ai/browser-utils', () => ( {
	launchChromiumWithInstall: vi.fn(),
} ) );

// A minimal stand-in for the Playwright `Browser`/`Page` that `buildVisualParityValidationArtifacts`
// drives, so the routing fix can be proven against the real orchestration function without a real
// browser. `evaluate()` is dispatched by inspecting the callback body, since that's the only
// signal available for which of the three page-context probes (readiness signature, lazy-load
// scroll, section/landmark extraction) is being run.
function createFakeBrowser( routeStatuses: Record< string, number >, visitedPaths: string[] ) {
	const newPage = async () => ( {
		goto: async ( url: string ) => {
			visitedPaths.push( new URL( url ).pathname );
			const status = routeStatuses[ new URL( url ).pathname ] ?? 200;
			return { status: () => status };
		},
		waitForLoadState: async () => undefined,
		waitForTimeout: async () => undefined,
		evaluate: async ( fn: ( ...args: unknown[] ) => unknown ) => {
			const source = fn.toString();
			if ( source.includes( 'nodeCount' ) ) {
				return { nodeCount: 1, imageCount: 0, completeImageCount: 0, height: 100 };
			}
			if ( source.includes( 'scrollTo' ) ) {
				return undefined;
			}
			return { viewport: VISUAL_PARITY_VIEWPORT, page_height: 100, sections: [], landmarks: [] };
		},
		close: async () => undefined,
	} );
	return { newPage, close: async () => undefined };
}

function requiredLayoutBaselinePaths( prefix: string, pageCount: number ): string[] {
	const paths = [
		`${ prefix } schema ${ LAYOUT_BASELINE_SCHEMA }`,
		`${ prefix }.viewports`,
		`${ prefix }.pages`,
		`${ prefix }.intentional_omissions`,
	];
	for ( let index = 0; index < pageCount; index++ ) {
		paths.push(
			`${ prefix }.pages.${ index }.id`,
			`${ prefix }.pages.${ index }.viewport`,
			`${ prefix }.pages.${ index }.sections`
		);
	}
	return paths;
}

function missingLayoutBaselineContract(
	baseline: unknown,
	prefix = VISUAL_PARITY_COMPILER_REPORT_PATH
): string[] {
	const missing: string[] = [];
	const record =
		baseline && typeof baseline === 'object' ? ( baseline as Record< string, unknown > ) : {};
	if ( record.schema !== LAYOUT_BASELINE_SCHEMA ) {
		missing.push( `${ prefix } schema ${ LAYOUT_BASELINE_SCHEMA }` );
	}
	for ( const field of [ 'viewports', 'pages', 'intentional_omissions' ] ) {
		if ( ! Array.isArray( record[ field ] ) ) {
			missing.push( `${ prefix }.${ field }` );
		}
	}
	const pages = Array.isArray( record.pages ) ? record.pages : [];
	pages.forEach( ( page, index ) => {
		if ( ! page || typeof page !== 'object' || Array.isArray( page ) ) {
			missing.push( `${ prefix }.pages.${ index }` );
			return;
		}
		const row = page as Record< string, unknown >;
		if ( typeof row.id !== 'string' || row.id.trim() === '' ) {
			missing.push( `${ prefix }.pages.${ index }.id` );
		}
		if ( ! row.viewport || typeof row.viewport !== 'object' || Array.isArray( row.viewport ) ) {
			missing.push( `${ prefix }.pages.${ index }.viewport` );
		}
		if ( ! Array.isArray( row.sections ) ) {
			missing.push( `${ prefix }.pages.${ index }.sections` );
		}
	} );
	return missing;
}

function layoutBaselineFromEnvelope( envelope: unknown ): unknown {
	if ( ! envelope || typeof envelope !== 'object' || Array.isArray( envelope ) ) {
		return {};
	}
	const root = envelope as Record< string, unknown >;
	for ( const key of [ 'visual_parity', 'visual_parity_oracle' ] ) {
		if ( ! root[ key ] || typeof root[ key ] !== 'object' ) {
			continue;
		}
		const nested = layoutBaselineFromEnvelope( root[ key ] );
		if ( nested && typeof nested === 'object' && ! Array.isArray( nested ) ) {
			const record = nested as Record< string, unknown >;
			if ( record.schema || record.pages || record.viewports ) {
				return nested;
			}
		}
	}
	const reports =
		root.source_reports && typeof root.source_reports === 'object'
			? ( root.source_reports as Record< string, unknown > )
			: {};
	if ( reports.layout_baseline && typeof reports.layout_baseline === 'object' ) {
		return reports.layout_baseline;
	}
	if ( root.layout_baseline && typeof root.layout_baseline === 'object' ) {
		return root.layout_baseline;
	}
	return {};
}

const capturedIndex: CapturedSectionPage = {
	sourceUrl: 'https://example.com/',
	viewport: VISUAL_PARITY_VIEWPORT,
	sections: [
		{
			sectionIndex: 0,
			selector: 'section.hero',
			top: 80,
			height: 640,
			headings: [ 'The Awards' ],
			headingSizes: [ 72 ],
			images: [
				{
					alt: 'logo',
					url: 'https://example.com/logo.png',
					selector: '#header-logo',
					kind: 'img',
					displayWidth: 36,
					displayHeight: 36,
				},
			],
			forms: [
				{
					fields: [
						{
							kind: 'text',
							name: 'nominee',
							label: 'Nominee',
							displayWidth: 320,
							displayHeight: 48,
						},
					],
				},
			],
		},
	],
	landmarks: [
		{ role: 'header', tag: 'header', top: 0, height: 80, mediaCount: 1 },
		{ role: 'nav', tag: 'nav', top: 0, height: 80, mediaCount: 0 },
		{ role: 'main', tag: 'main', top: 80, height: 640, mediaCount: 1 },
		{ role: 'footer', tag: 'footer', top: 720, height: 120, mediaCount: 0 },
	],
};

const capturedInner: CapturedSectionPage = {
	sourceUrl: 'https://example.com/social-kit',
	viewport: VISUAL_PARITY_VIEWPORT,
	sections: [
		{
			sectionIndex: 0,
			selector: 'section.kit',
			top: 0,
			height: 400,
			headings: [ 'Social kit' ],
			headingSizes: [ 48 ],
			images: [],
		},
	],
	landmarks: [ { role: 'main', tag: 'main', top: 0, height: 400, mediaCount: 0 } ],
};

describe( 'visual parity oracle payload contract', () => {
	let tmpDir: string | undefined;

	afterEach( () => {
		if ( tmpDir ) {
			fs.rmSync( tmpDir, { recursive: true, force: true } );
			tmpDir = undefined;
		}
	} );

	it( 'emits source_reports.layout_baseline and imported_render in layout-baseline/v1 shape', () => {
		const payload = toVisualParityOraclePayload(
			{ index: capturedIndex, 'social-kit': capturedInner },
			{ index: capturedIndex }
		);
		const envelope = { visual_parity: payload };
		const baseline = layoutBaselineFromEnvelope( envelope );
		const missing = missingLayoutBaselineContract( baseline );

		expect( payload.schema ).toBe( LAYOUT_BASELINE_SCHEMA );
		expect( payload.stage ).toBe( VISUAL_PARITY_STAGE );
		expect( payload.source_reports.layout_baseline.schema ).toBe( LAYOUT_BASELINE_SCHEMA );
		expect( Array.isArray( payload.source_reports.layout_baseline.viewports ) ).toBe( true );
		expect( Array.isArray( payload.source_reports.layout_baseline.pages ) ).toBe( true );
		expect( Array.isArray( payload.source_reports.layout_baseline.intentional_omissions ) ).toBe(
			true
		);
		expect( payload.imported_render ).toBeDefined();
		expect( Array.isArray( payload.imported_render?.pages ) ).toBe( true );
		expect( missing ).toEqual( [] );
		expect( requiredLayoutBaselinePaths( VISUAL_PARITY_COMPILER_REPORT_PATH, 2 ) ).toEqual(
			expect.arrayContaining( [
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH } schema ${ LAYOUT_BASELINE_SCHEMA }`,
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH }.viewports`,
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH }.pages`,
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH }.intentional_omissions`,
			] )
		);
	} );

	it( 'keeps a captured page that the imported site is missing so the oracle can disagree', () => {
		const payload = toVisualParityOraclePayload(
			{ index: capturedIndex, 'social-kit': capturedInner },
			{ index: capturedIndex }
		);
		const sourceIds = payload.source_reports.layout_baseline.pages.map( ( page ) => page.id );
		const importedIds = payload.imported_render?.pages.map( ( page ) => page.id ) ?? [];
		expect( sourceIds ).toEqual( expect.arrayContaining( [ 'index', 'social-kit' ] ) );
		expect( importedIds ).toEqual( [ 'index' ] );
		expect( importedIds ).not.toContain( 'social-kit' );
	} );

	it( 'serializes section geometry with the field names the oracle compares', () => {
		const payload = toVisualParityOraclePayload(
			{ index: capturedIndex },
			{ index: capturedIndex }
		);
		const page = payload.source_reports.layout_baseline.pages[ 0 ];
		const section = page.sections[ 0 ] as Record< string, unknown >;
		const heading = ( section.headings as Record< string, unknown >[] )[ 0 ];
		const media = ( section.media as Record< string, unknown >[] )[ 0 ];
		const field = (
			( section.forms as Record< string, unknown >[] )[ 0 ].fields as Record< string, unknown >[]
		 )[ 0 ];
		const landmarkRoles = page.landmarks.map( ( landmark ) => landmark.role );

		expect( page.id ).toBe( 'index' );
		expect( page.viewport ).toEqual( VISUAL_PARITY_VIEWPORT );
		expect( typeof page.page_height ).toBe( 'number' );
		expect( section.top ).toBe( 80 );
		expect( ( section.offset as { top: number } ).top ).toBe( 80 );
		expect( section.height ).toBe( 640 );
		expect( heading.font_size ).toBe( 72 );
		expect( heading.text ).toBe( 'The Awards' );
		expect( section ).not.toHaveProperty( 'images' );
		expect( media.display_width ).toBe( 36 );
		expect( media.display_height ).toBe( 36 );
		expect( field.display_width ).toBe( 320 );
		expect( field.display_height ).toBe( 48 );
		expect( landmarkRoles ).toEqual( [ 'header', 'main', 'footer' ] );
		expect( landmarkRoles ).not.toContain( 'nav' );
	} );

	it( 'loads DLA section files and still satisfies the layout-baseline contract', () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-visual-parity-' ) );
		fs.writeFileSync(
			path.join( tmpDir, 'index.json' ),
			JSON.stringify( {
				sourceUrl: 'https://example.com/',
				viewport: VISUAL_PARITY_VIEWPORT,
				sections: [
					{
						sectionIndex: 0,
						top: 10,
						height: 200,
						headings: [ 'Hello' ],
						headingSizes: [ 32 ],
						images: [ { alt: '', url: '', kind: 'img', displayWidth: 16, displayHeight: 16 } ],
						icons: [ { kind: 'svg', width: 16, height: 16 } ],
					},
				],
				landmarks: [ { role: 'main', tag: 'main', mediaCount: 1 } ],
			} )
		);
		const pages = loadCapturedSectionPages( tmpDir );
		const payload = toVisualParityOraclePayload( pages, pages );
		expect( missingLayoutBaselineContract( payload.source_reports.layout_baseline ) ).toEqual( [] );
		const media = (
			payload.source_reports.layout_baseline.pages[ 0 ].sections[ 0 ] as {
				media: unknown[];
			}
		 ).media;
		expect( media ).toHaveLength( 2 );
	} );

	it( 'would have caught the pre-migration source_pages/imported_pages envelope', () => {
		const drifted = {
			schema: 'static-site-importer/visual-parity-oracle-input/v1',
			stage: 'import_vs_capture',
			source_pages: { index: capturedIndex },
			imported_pages: { index: capturedIndex },
		};
		const baseline = layoutBaselineFromEnvelope( { visual_parity: drifted } );
		const missing = missingLayoutBaselineContract( baseline );
		expect( missing ).toEqual(
			expect.arrayContaining( [
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH } schema ${ LAYOUT_BASELINE_SCHEMA }`,
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH }.viewports`,
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH }.pages`,
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH }.intentional_omissions`,
			] )
		);
	} );
} );

describe( 'visualParityGateFailure', () => {
	const readyArtifacts: VisualParityArtifacts = toVisualParityOraclePayload(
		{ index: capturedIndex },
		{ index: capturedIndex }
	);
	const unverifiedArtifacts: VisualParityArtifacts = {
		...readyArtifacts,
		status: 'not_verified',
		verification: 'not_verified',
		reason: 'No captured section records were available to compare.',
		imported_render: undefined,
	};

	it( 'fails a populated payload when the oracle answers not_verified', () => {
		const evaluation: VisualParityEvaluation = {
			status: 'not_verified',
			reason: 'Layout baseline contract is absent or malformed.',
			missing_data_contract: [
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH } schema ${ LAYOUT_BASELINE_SCHEMA }`,
				`${ VISUAL_PARITY_COMPILER_REPORT_PATH }.pages`,
			],
		};
		const detail = visualParityGateFailure( readyArtifacts, evaluation );
		expect( detail ).toContain( 'Layout baseline contract is absent or malformed.' );
		expect( detail ).toContain( `${ VISUAL_PARITY_COMPILER_REPORT_PATH }.pages` );
	} );

	it( 'does not fail a genuine could-not-measure case', () => {
		const evaluation: VisualParityEvaluation = {
			status: 'not_verified',
			reason: 'Imported layout record was not provided.',
			missing_data_contract: [],
		};
		expect( visualParityGateFailure( unverifiedArtifacts, evaluation ) ).toBeUndefined();
	} );

	it( 'surfaces oracle disagreements', () => {
		const evaluation: VisualParityEvaluation = {
			status: 'failed',
			reason: 'Imported section geometry disagrees with the layout baseline.',
			disagreements: [
				{
					page: 'social-kit',
					section: null,
					code: 'missing_imported_page',
					message: 'Imported render did not include this baseline page.',
				},
			],
		};
		expect( visualParityGateFailure( readyArtifacts, evaluation ) ).toContain(
			'missing_imported_page'
		);
	} );

	it( 'treats a passed evaluation as a pass', () => {
		const evaluation: VisualParityEvaluation = {
			status: 'passed',
			reason: 'Imported section geometry matches the layout baseline within tolerances.',
			disagreements: [],
		};
		expect( visualParityGateFailure( readyArtifacts, evaluation ) ).toBeUndefined();
	} );
} );

describe( 'routeForCapturedPage', () => {
	let tmpDir: string | undefined;

	afterEach( () => {
		if ( tmpDir ) {
			fs.rmSync( tmpDir, { recursive: true, force: true } );
			tmpDir = undefined;
		}
	} );

	it( 'probes a subpath-hosted source at the route its export occupies', () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-visual-parity-routes-' ) );
		const sectionsDir = path.join( tmpDir, 'sections' );
		fs.mkdirSync( sectionsDir );
		fs.writeFileSync(
			path.join( tmpDir, 'capture-receipt.json' ),
			JSON.stringify( {
				websiteRoot: 'website',
				routes: [
					{ url: 'https://user.wixsite.com/my-site', path: 'website/index.html' },
					{
						url: 'https://user.wixsite.com/my-site/privacy-policy',
						path: 'website/privacy-policy/index.html',
					},
				],
			} )
		);

		const routes = loadCapturedRoutes( sectionsDir );

		expect( routeForCapturedPage( 'my-site', 'https://user.wixsite.com/my-site', routes ) ).toBe(
			'/'
		);
		expect(
			routeForCapturedPage(
				'my-site--privacy-policy',
				'https://user.wixsite.com/my-site/privacy-policy',
				routes
			)
		).toBe( '/privacy-policy/' );
	} );

	it( 'falls back to the source URL path when the receipt has no matching route', () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-visual-parity-routes-' ) );
		const routes = loadCapturedRoutes( path.join( tmpDir, 'sections' ) );

		expect( routes.size ).toBe( 0 );
		expect( routeForCapturedPage( 'social-kit', 'https://example.com/social-kit', routes ) ).toBe(
			'/social-kit'
		);
		expect( routeForCapturedPage( 'index', undefined, routes ) ).toBe( '/' );
	} );

	it( 'maps a captured route with a document extension to the permalink WordPress publishes, not the raw exported path', () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-visual-parity-routes-' ) );
		const sectionsDir = path.join( tmpDir, 'sections' );
		fs.mkdirSync( sectionsDir );
		fs.writeFileSync(
			path.join( tmpDir, 'capture-receipt.json' ),
			JSON.stringify( {
				websiteRoot: 'website',
				routes: [
					{ url: 'https://example.com/', path: 'website/index.html' },
					{ url: 'https://example.com/day-13.html', path: 'website/day-13.html' },
				],
			} )
		);

		const routes = loadCapturedRoutes( sectionsDir );

		// The entry/index route maps to the site root, not `/index.html/`.
		expect( routeForCapturedPage( 'index', 'https://example.com/', routes ) ).toBe( '/' );
		// A `.html` route maps to the imported permalink WordPress actually publishes
		// (`post_name` drops the extension), not `/day-13.html/`.
		expect( routeForCapturedPage( 'day-13', 'https://example.com/day-13.html', routes ) ).toBe(
			'/day-13/'
		);
	} );
} );

describe( 'buildVisualParityValidationArtifacts', () => {
	let tmpDir: string | undefined;

	afterEach( () => {
		vi.mocked( launchChromiumWithInstall ).mockReset();
		if ( tmpDir ) {
			fs.rmSync( tmpDir, { recursive: true, force: true } );
			tmpDir = undefined;
		}
	} );

	it( 'probes the imported permalink for a `.html` route and still reports a page that genuinely did not import', async () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-visual-parity-build-' ) );
		const sectionsDir = path.join( tmpDir, 'sections' );
		fs.mkdirSync( sectionsDir );
		fs.writeFileSync(
			path.join( tmpDir, 'capture-receipt.json' ),
			JSON.stringify( {
				websiteRoot: 'website',
				routes: [
					{ url: 'https://example.com/', path: 'website/index.html' },
					{ url: 'https://example.com/day-13.html', path: 'website/day-13.html' },
					{ url: 'https://example.com/day-99.html', path: 'website/day-99.html' },
				],
			} )
		);
		for ( const [ name, sourceUrl ] of [
			[ 'index.json', 'https://example.com/' ],
			[ 'day-13.json', 'https://example.com/day-13.html' ],
			[ 'day-99.json', 'https://example.com/day-99.html' ],
		] as const ) {
			fs.writeFileSync(
				path.join( sectionsDir, name ),
				JSON.stringify( {
					sourceUrl,
					viewport: VISUAL_PARITY_VIEWPORT,
					sections: [],
					landmarks: [],
				} )
			);
		}

		const visitedPaths: string[] = [];
		// `/day-99/` is the corrected permalink for a page that genuinely never imported —
		// the fix must not paper over that by making every lookup succeed.
		vi.mocked( launchChromiumWithInstall ).mockResolvedValue(
			createFakeBrowser(
				{ '/': 200, '/day-13/': 200, '/day-99/': 404 },
				visitedPaths
			) as unknown as Awaited< ReturnType< typeof launchChromiumWithInstall > >
		);

		const artifacts = await buildVisualParityValidationArtifacts( {
			sectionsDir,
			importedOrigin: 'http://localhost:8890',
			logger: { warn: () => undefined },
		} );

		expect( visitedPaths ).toContain( '/day-13/' );
		expect( visitedPaths ).not.toContain( '/day-13.html/' );

		const importedIds = artifacts.imported_render?.pages.map( ( page ) => page.id ) ?? [];
		expect( importedIds ).toEqual( expect.arrayContaining( [ 'index', 'day-13' ] ) );
		expect( importedIds ).not.toContain( 'day-99' );

		const sourceIds = artifacts.source_reports.layout_baseline.pages.map( ( page ) => page.id );
		expect( sourceIds ).toEqual( expect.arrayContaining( [ 'index', 'day-13', 'day-99' ] ) );
	} );
} );
