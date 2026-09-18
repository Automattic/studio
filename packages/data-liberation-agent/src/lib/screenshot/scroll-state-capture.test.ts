import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { captureScrollStates, SCROLL_STATES_SCHEMA } from './scroll-state-capture.js';

const STICKY_HEADER_FIXTURE = `<!doctype html><html><head><style>
	body { margin: 0; height: 3000px; }
	#header { position: fixed; top: 0; left: 0; right: 0; height: 80px; background-color: rgba(0,0,0,0); transition: background-color 0.15s; }
	#header.stuck { background-color: rgba(255,255,255,0.9); }
	#logo { transition: max-height 0.15s; display: block; }
</style></head>
<body>
	<div id="header"><img id="logo" alt="logo" style="max-height: 100px; margin-top: 0px;" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7"></div>
	<script>
		window.addEventListener('scroll', () => {
			const stuck = window.scrollY > 50;
			document.getElementById('header').classList.toggle('stuck', stuck);
			document.getElementById('logo').style.maxHeight = stuck ? '50px' : '100px';
		});
	</script>
</body></html>`;

const STATIC_HEADER_FIXTURE = `<!doctype html><html><head><style>
	body { margin: 0; height: 3000px; }
	#header { position: fixed; top: 0; left: 0; right: 0; height: 80px; }
</style></head>
<body>
	<div id="header"><img id="logo" alt="logo" style="max-height: 100px;" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7"></div>
</body></html>`;

const IRREVERSIBLE_FIXTURE = `<!doctype html><html><head><style>
	body { margin: 0; height: 3000px; }
	#header { position: fixed; top: 0; left: 0; right: 0; height: 80px; }
	#header.seen { background-color: rgba(20,20,20,0.9); }
</style></head>
<body>
	<div id="header"></div>
	<script>
		window.addEventListener('scroll', () => {
			if (window.scrollY > 50) document.getElementById('header').classList.add('seen');
		});
	</script>
</body></html>`;

const BODY_AFFIX_INNER_BAR_FIXTURE = `<!doctype html><html><head><style>
	body { margin: 0; height: 3000px; }
	.header-wrap { height: 240px; background: transparent; }
	#topBar { position: absolute; top: 0; left: 0; right: 0; height: 61px; background-color: transparent; }
	body.affix #topBar { position: fixed; height: 50px; background-color: rgb(43, 43, 43); }
</style></head>
<body>
	<div class="header-wrap"><div id="topBar">MENU</div></div>
	<script>
		window.addEventListener('scroll', () => {
			document.body.classList.toggle('affix', window.scrollY > 10);
		});
	</script>
</body></html>`;

describe( 'captureScrollStates', () => {
	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'captures a scroll-driven class toggle and inline-style shrink, with a reproducible threshold',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( STICKY_HEADER_FIXTURE );
				const report = await captureScrollStates( page, 'https://example.test/' );

				expect( report.schema ).toBe( SCROLL_STATES_SCHEMA );
				expect( report.toggles ).toHaveLength( 1 );
				const toggle = report.toggles[ 0 ];
				expect( toggle.status ).toBe( 'captured' );
				expect( toggle.target.selector ).toBe( '#header' );
				expect( toggle.classes.add ).toContain( 'stuck' );
				expect( toggle.classes.remove ).toHaveLength( 0 );
				expect( toggle.thresholdPx ).toBeGreaterThan( 50 );
				expect( toggle.thresholdPx ).toBeLessThanOrEqual( 200 );

				const styleTarget = toggle.styleTargets.find( ( target ) => target.id === 'logo' );
				expect( styleTarget?.properties[ 'max-height' ] ).toEqual( { rest: '100px', scrolled: '50px' } );

				// The page must be left scrolled back to the top (clean state for
				// subsequent baseline captures — screenshots, geometry, etc.).
				expect( await page.evaluate( () => window.scrollY ) ).toBe( 0 );
			} finally {
				await browser.close();
			}
		},
		30_000
	);

	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'reports no toggles for a static header that never changes on scroll',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( STATIC_HEADER_FIXTURE );
				const report = await captureScrollStates( page, 'https://example.test/' );
				expect( report.toggles ).toHaveLength( 0 );
			} finally {
				await browser.close();
			}
		},
		30_000
	);

	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'ignores a one-way (irreversible) class mutation — that is not scroll-linked chrome',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( IRREVERSIBLE_FIXTURE );
				const report = await captureScrollStates( page, 'https://example.test/' );
				expect( report.toggles ).toHaveLength( 0 );
			} finally {
				await browser.close();
			}
		},
		30_000
	);

	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'captures computed restyle of a nested header bar driven by a body scroll class',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( BODY_AFFIX_INNER_BAR_FIXTURE );
				const report = await captureScrollStates( page, 'https://example.test/' );
				const toggle = report.toggles.find( ( entry ) => entry.target.id === 'topBar' );
				expect( toggle ).toBeDefined();
				expect( toggle?.classes.add ).toHaveLength( 0 );
				const self = toggle?.styleTargets.find( ( target ) => target.selector === ':scope' );
				expect( self?.properties[ 'background-color' ]?.scrolled ).toContain( '43' );
				expect( self?.properties.position ).toEqual( { rest: 'absolute', scrolled: 'fixed' } );
			} finally {
				await browser.close();
			}
		},
		30_000
	);
} );
