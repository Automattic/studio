import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySourceCleanup, cleanupPolicy, readSourceCleanup } from '../source-cleanup.js';
import {
	captureSelectableSetStates,
	SELECTABLE_SET_KIND,
	SELECTABLE_SET_LIMITS,
} from './selectable-set-capture.js';

const skipBrowser = process.env.SKIP_BROWSER_TESTS;

/**
 * A relative `href` only navigates against a real origin, and `setContent`
 * leaves the page on `about:blank` where it cannot. These fixtures are served
 * from an intercepted synthetic origin so a probe click that reaches a link
 * commits the same full-document navigation a live site would.
 */
const ORIGIN = 'https://selectable-set.test';

async function serve( page: Page, html: string ): Promise< void > {
	await page.route( `${ ORIGIN }/**`, ( route ) =>
		route.fulfill( { contentType: 'text/html', body: html } )
	);
	await page.goto( `${ ORIGIN }/` );
}

const PICKER_PAGE = `<!doctype html><html><body>
	<div id="layout">
		<div id="picker">
			<div id="z1" style="cursor:pointer">Zone 1</div>
			<div id="z2" style="cursor:pointer">Zone 2</div>
			<div id="z3" style="cursor:pointer">Zone 3</div>
		</div>
		<div id="panel">Select a zone to view details.</div>
	</div>
	<script>
		const details = {
			z1: 'Zone 1 / Production / A climate-controlled room with a 18/6 light cycle.',
			z2: 'Zone 2 / Processing / Packaging line with humidity held at 45-55 percent RH.',
			z3: 'Zone 3 / Storage / Cold room held at 4C for finished goods.',
		};
		window.clicks = [];
		document.querySelectorAll('#picker > *').forEach((zone) => {
			zone.addEventListener('click', () => {
				window.clicks.push(zone.id);
				document.getElementById('panel').textContent = details[zone.id];
			});
		});
	</script>
</body></html>`;

/** The card grid every site builder emits: the link wraps the styled tile. */
const CARDS = `<div id="cards">
		<a href="/one"><div style="cursor:pointer">Card one summary copy for the grid.</div></a>
		<a href="/two"><div style="cursor:pointer">Card two summary copy for the grid.</div></a>
		<a href="/three"><div style="cursor:pointer">Card three summary copy for the grid.</div></a>
	</div>`;

const LINK_WRAPPED_CARDS_PAGE = `<!doctype html><html><body>
	<main>
		${ CARDS }
		<div id="panel">Nearby copy that should not be attributed to the cards.</div>
	</main>
</body></html>`;

const CARDS_BESIDE_PICKER_PAGE = `<!doctype html><html><body>
	<main>
		${ CARDS }
		<div id="picker">
			<div id="z1" style="cursor:pointer">Zone 1</div>
			<div id="z2" style="cursor:pointer">Zone 2</div>
			<div id="z3" style="cursor:pointer">Zone 3</div>
		</div>
		<div id="panel">Select a zone to view details.</div>
	</main>
	<script>
		const details = {
			z1: 'Zone 1 / Production / A climate-controlled room with a 18/6 light cycle.',
			z2: 'Zone 2 / Processing / Packaging line with humidity held at 45-55 percent RH.',
			z3: 'Zone 3 / Storage / Cold room held at 4C for finished goods.',
		};
		document.querySelectorAll('#picker > *').forEach((zone) => {
			zone.addEventListener('click', () => {
				document.getElementById('panel').textContent = details[zone.id];
			});
		});
	</script>
</body></html>`;

/** Tiles that carry no href and navigate by following a link from script. */
const TILES = `<div id="tiles">
		<div id="t1" data-target="/one" style="cursor:pointer">Tile one summary copy.</div>
		<div id="t2" data-target="/two" style="cursor:pointer">Tile two summary copy.</div>
		<div id="t3" data-target="/three" style="cursor:pointer">Tile three summary copy.</div>
	</div>
	<div id="panel">Select a tile to view details.</div>`;

const SCRIPTED_LINK_TILES_PAGE = `<!doctype html><html><body>
	<main>${ TILES }</main>
	<script>
		document.querySelectorAll('#tiles > *').forEach((tile) => {
			tile.addEventListener('click', () => {
				const link = document.createElement('a');
				link.href = tile.dataset.target;
				document.body.append(link);
				link.click();
			});
		});
	</script>
</body></html>`;

const SCRIPTED_ASSIGN_TILES_PAGE = `<!doctype html><html><body>
	<main>${ TILES }</main>
	<script>
		document.querySelectorAll('#tiles > *').forEach((tile) => {
			tile.addEventListener('click', () => { location.assign(tile.dataset.target); });
		});
	</script>
</body></html>`;

const LABEL_FILTER_PAGE = `<!doctype html><html><body>
	<main>
		<div id="filters">
			<label id="f1" style="cursor:pointer"><input type="radio" name="filter" value="alpha" hidden>Alpha</label>
			<label id="f2" style="cursor:pointer"><input type="radio" name="filter" value="beta" hidden>Beta</label>
			<label id="f3" style="cursor:pointer"><input type="radio" name="filter" value="gamma" hidden>Gamma</label>
		</div>
		<div id="grid">Choose a filter.</div>
	</main>
	<script>
		const copy = {
			alpha: 'Alpha strains / Orangutan, Sunrise, Harbour Light and four more.',
			beta: 'Beta strains / Wedding, Northern Aurora and two more on request.',
			gamma: 'Gamma strains / Coastal Fog and Midnight Harvest, seasonal only.',
		};
		document.querySelectorAll('#filters input').forEach((input) => {
			input.addEventListener('change', () => {
				document.getElementById('grid').textContent = copy[input.value];
			});
		});
	</script>
</body></html>`;

const ICON_CHOICE_PAGE = `<!doctype html><html><body>
	<form id="feedback">
		<div id="rating-field">
			<label id="rating-label">Rating</label>
			<div id="rating-choices">
				${ [ 0, 1, 2, 3, 4 ].map( ( index ) => `<button type="button"><svg data-star="${ index }" style="fill:rgb(251, 191, 36)"></svg></button>` ).join( '' ) }
			</div>
		</div>
	</form>
	<script>
		window.submits = 0;
		document.getElementById('feedback').addEventListener('submit', (event) => { event.preventDefault(); window.submits++; });
		document.querySelectorAll('#rating-choices button').forEach((button, index) => button.addEventListener('click', () => {
			document.querySelectorAll('#rating-choices svg').forEach((star, starIndex) => { star.style.fill = starIndex <= index ? 'rgb(251, 191, 36)' : 'none'; });
		}));
	</script>
</body></html>`;

const INDEPENDENT_TOGGLE_PAGE = `<!doctype html><html><body>
	<div id="toggles" role="group" aria-label="Formatting">
		<button type="button" aria-label="Bold" aria-pressed="false" style="width:48px;height:48px"><svg width="20" height="20"><rect width="20" height="20"/></svg></button>
		<button type="button" aria-label="Italic" aria-pressed="false" style="width:48px;height:48px"><svg width="20" height="20"><circle cx="10" cy="10" r="9"/></svg></button>
		<button type="button" aria-label="Underline" aria-pressed="false" style="width:48px;height:48px"><svg width="20" height="20"><path d="M0 10H20"/></svg></button>
	</div>
	<script>document.querySelectorAll('#toggles button').forEach((button) => button.addEventListener('click', () => button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')));</script>
</body></html>`;

const HISTORY_DEPENDENT_PAGE = `<!doctype html><html><body>
	<div id="history" role="group" aria-label="History">
		<button type="button" aria-label="First" style="width:48px;height:48px">First</button>
		<button type="button" aria-label="Second" style="width:48px;height:48px">Second</button>
		<button type="button" aria-label="Third" style="width:48px;height:48px">Third</button>
	</div>
	<script>document.querySelectorAll('#history button').forEach((button) => button.addEventListener('click', () => button.dataset.count = String(Number(button.dataset.count || 0) + 1)));</script>
</body></html>`;

const CLOSURE_ABSOLUTE_PAGE = `<!doctype html><html><body>
	<div id="absolute" role="group" aria-label="Absolute choice" data-state="0">
		<button type="button" aria-label="One"><svg><rect data-choice="0"></rect></svg></button>
		<button type="button" aria-label="Two"><svg><rect data-choice="1"></rect></svg></button>
		<button type="button" aria-label="Three"><svg><rect data-choice="2"></rect></svg></button>
	</div>
	<script>
		window.choiceState = 0;
		const root = document.getElementById('absolute');
		const render = () => {
			root.dataset.state = String(window.choiceState);
			root.querySelectorAll('rect').forEach((rect, index) => { rect.setAttribute('fill', index === window.choiceState ? 'gold' : 'none'); });
		};
		root.querySelectorAll('button').forEach((button, index) => button.addEventListener('click', () => { window.choiceState = index; render(); }));
		render();
	</script>
</body></html>`;

describe( 'captureSelectableSetStates', () => {
	let browser: Browser;

	beforeAll( async () => {
		if ( skipBrowser ) return;
		browser = await chromium.launch( { headless: true } );
	} );

	afterAll( async () => {
		await browser?.close();
	} );

	it.skipIf( skipBrowser )(
		'captures distinct shared-region content for each member',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( PICKER_PAGE );
				const states = await captureSelectableSetStates( page );
				expect( states ).toHaveLength( 3 );
				expect( states.every( ( state ) => state.kind === SELECTABLE_SET_KIND ) ).toBe( true );
				expect( states.every( ( state ) => state.status === 'captured' ) ).toBe( true );
				expect( states.map( ( state ) => state.trigger.id ) ).toEqual( [ 'z1', 'z2', 'z3' ] );
				expect( states.map( ( state ) => state.set ) ).toEqual( [
					{ selector: '#picker', size: 3, index: 0 },
					{ selector: '#picker', size: 3, index: 1 },
					{ selector: '#picker', size: 3, index: 2 },
				] );
				expect( states[ 0 ].dialog?.id ).toBe( 'panel' );
				expect( states[ 0 ].dialog?.html ).toContain( 'Zone 1 / Production' );
				expect( states[ 1 ].dialog?.html ).toContain( 'Zone 2 / Processing' );
				expect( states[ 2 ].dialog?.html ).toContain( 'Zone 3 / Storage' );
				expect( await page.locator( '#panel' ).textContent() ).toBe(
					'Select a zone to view details.'
				);
				expect(
					await page.locator( '[data-lib-selectable-region],[data-lib-selectable-member]' ).count()
				).toBe( 0 );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'orders states deterministically across repeated captures',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( PICKER_PAGE );
				const first = await captureSelectableSetStates( page );
				const second = await captureSelectableSetStates( page );
				expect( first ).toEqual( second );
				expect( first.map( ( state ) => state.trigger.id ) ).toEqual( [ 'z1', 'z2', 'z3' ] );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'bounds the number of members driven',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div id="layout">
						<div id="picker"></div>
						<div id="panel">idle</div>
					</div>
					<script>
						window.clicks = [];
						const picker = document.getElementById('picker');
						const panel = document.getElementById('panel');
						for (let index = 0; index < 10; index++) {
							const zone = document.createElement('div');
							zone.id = 'z' + index;
							zone.style.cursor = 'pointer';
							zone.textContent = 'Zone ' + index;
							zone.addEventListener('click', () => {
								window.clicks.push(zone.id);
								panel.textContent = 'Details for zone ' + index + ' with unique copy.';
							});
							picker.append(zone);
						}
					</script>
				</body></html>` );
				const states = await captureSelectableSetStates( page, { maxMembers: 3 } );
				const clicks = await page.evaluate(
					() => ( window as typeof window & { clicks: string[] } ).clicks
				);
				expect( states ).toHaveLength( 3 );
				expect( states.every( ( state ) => state.status === 'captured' ) ).toBe( true );
				expect( states.map( ( state ) => state.trigger.id ) ).toEqual( [ 'z0', 'z1', 'z2' ] );
				expect( states[ 0 ].set ).toEqual( { selector: '#picker', size: 10, index: 0 } );
				expect( new Set( clicks ).has( 'z9' ) ).toBe( false );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'does not drive a recognised set once the time budget is spent',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div role="tablist">
						<button type="button" role="tab" id="t1">One</button>
						<button type="button" role="tab" id="t2">Two</button>
					</div>
					<div role="tabpanel" id="panel">Static panel</div>
					<script>
						window.clicks = 0;
						document.querySelectorAll('[role="tab"]').forEach((tab) => {
							tab.addEventListener('click', () => { window.clicks++; });
						});
					</script>
				</body></html>` );
				const states = await captureSelectableSetStates( page, { maxDriveMs: 0 } );
				expect( states ).toHaveLength( 1 );
				expect( states[ 0 ] ).toMatchObject( {
					status: 'no-dialog',
					kind: SELECTABLE_SET_KIND,
					trigger: { id: 't1' },
				} );
				expect( await page.evaluate( () => ( window as typeof window & { clicks: number } ).clicks ) ).toBe(
					0
				);
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'records click-failed when a recognised member cannot be driven',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div id="layout">
						<div id="picker">
							<div id="z1" style="cursor:pointer">Zone 1</div>
							<div id="z2" style="cursor:pointer">Zone 2</div>
							<div id="z3" style="cursor:pointer">Zone 3</div>
						</div>
						<div id="panel">idle</div>
					</div>
					<script>
						const nativeClick = HTMLElement.prototype.click;
						HTMLElement.prototype.click = function () {
							if (this.id === 'z3') throw new Error('native click blocked');
							return nativeClick.call(this);
						};
						const details = { z1: 'First zone copy that is long enough.', z2: 'Second zone copy that is long enough.', z3: 'Third zone copy that is long enough.' };
						document.querySelectorAll('#picker > *').forEach((zone) => {
							zone.addEventListener('click', () => {
								document.getElementById('panel').textContent = details[zone.id];
							});
						});
					</script>
				</body></html>` );
				const states = await captureSelectableSetStates( page );
				expect( states.map( ( state ) => [ state.trigger.id, state.status ] ) ).toEqual( [
					[ 'z1', 'captured' ],
					[ 'z2', 'captured' ],
					[ 'z3', 'click-failed' ],
				] );
				expect( states[ 2 ].error ).toMatch( /native click blocked/ );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'records no-dialog when a recognised set does not mutate a shared region',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div role="tablist">
						<button type="button" role="tab" id="t1">One</button>
						<button type="button" role="tab" id="t2">Two</button>
						<button type="button" role="tab" id="t3">Three</button>
					</div>
					<div role="tabpanel" id="panel">Static panel that never changes.</div>
				</body></html>` );
				const states = await captureSelectableSetStates( page );
				expect( states ).toHaveLength( 1 );
				expect( states[ 0 ] ).toMatchObject( {
					status: 'no-dialog',
					kind: SELECTABLE_SET_KIND,
					trigger: { id: 't1', role: 'tab' },
					set: { size: 3, index: 0 },
				} );
				expect( states[ 0 ].dialog ).toBeUndefined();
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'does not treat a list of navigation links as a selectable set',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<main>
						<div id="links">
							<a href="/one">One</a>
							<a href="/two">Two</a>
							<a href="/three">Three</a>
						</div>
						<div id="panel">Nearby copy that should not be attributed to the links.</div>
					</main>
				</body></html>` );
				expect( await captureSelectableSetStates( page ) ).toEqual( [] );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'records no-dialog for a member that does not change the confirmed region',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div id="layout">
						<div id="picker">
							<div id="z1" style="cursor:pointer">Zone 1</div>
							<div id="z2" style="cursor:pointer">Zone 2</div>
							<div id="z3" style="cursor:pointer">Zone 3</div>
						</div>
						<div id="panel">idle</div>
					</div>
					<script>
						document.getElementById('z1').addEventListener('click', () => {
							document.getElementById('panel').textContent = 'First zone copy that is long enough.';
						});
						document.getElementById('z2').addEventListener('click', () => {
							document.getElementById('panel').textContent = 'Second zone copy that is long enough.';
						});
					</script>
				</body></html>` );
				const states = await captureSelectableSetStates( page );
				expect( states.map( ( state ) => [ state.trigger.id, state.status ] ) ).toEqual( [
					[ 'z1', 'captured' ],
					[ 'z2', 'captured' ],
					[ 'z3', 'no-dialog' ],
				] );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'picks the shared region with the largest content range, not the first small mutation',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div id="layout">
						<div id="picker">
							<div id="z1" style="cursor:pointer">Zone 1</div>
							<div id="z2" style="cursor:pointer">Zone 2</div>
							<div id="z3" style="cursor:pointer">Zone 3</div>
						</div>
						<div id="status">Click a zone</div>
						<div id="panel">Select a zone to view details.</div>
					</div>
					<script>
						const details = {
							z1: 'Zone 1 / Production / A climate-controlled room with a 18/6 light cycle.',
							z2: 'Zone 2 / Processing / Packaging line with humidity held at 45-55 percent RH.',
							z3: 'Zone 3 / Storage / Cold room held at 4C for finished goods.',
						};
						document.querySelectorAll('#picker > *').forEach((zone) => {
							zone.addEventListener('click', () => {
								document.getElementById('status').textContent = 'Clear Selection';
								if (zone.id !== 'z1') {
									document.getElementById('panel').textContent = details[zone.id];
								}
							});
						});
					</script>
				</body></html>` );
				const states = await captureSelectableSetStates( page );
				expect( states.map( ( state ) => [ state.trigger.id, state.status, state.dialog?.id ] ) ).toEqual( [
					[ 'z1', 'no-dialog', undefined ],
					[ 'z2', 'captured', 'panel' ],
					[ 'z3', 'captured', 'panel' ],
				] );
				expect( states[ 1 ].dialog?.html ).toContain( 'Zone 2 / Processing' );
				expect( states[ 2 ].dialog?.html ).toContain( 'Zone 3 / Storage' );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'captures pointer-only SVG zones that have no role or tabindex',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div id="layout">
						<svg id="map" viewBox="0 0 90 30" width="180" height="60">
							<g id="z1" style="cursor:pointer"><title>FR1</title><rect width="30" height="30" fill="#ccc"/></g>
							<g id="z2" style="cursor:pointer"><title>FR2</title><rect x="30" width="30" height="30" fill="#bbb"/></g>
							<g id="z3" style="cursor:pointer"><title>FR3</title><rect x="60" width="30" height="30" fill="#aaa"/></g>
						</svg>
						<div id="panel">Select a zone to view details.</div>
					</div>
					<script>
						const details = {
							z1: 'Flower Room 1 / Production / Operational / ZONE DESCRIPTION / LIGHT CYCLE 18/6.',
							z2: 'Flower Room 2 / Production / Operational / ZONE DESCRIPTION / CO2 SETPOINT 1200.',
							z3: 'Flower Room 3 / Production / Operational / ZONE DESCRIPTION / HUMIDITY 45-55.',
						};
						document.querySelectorAll('#map > g').forEach((zone) => {
							zone.addEventListener('click', () => {
								document.getElementById('panel').textContent = details[zone.id];
							});
						});
					</script>
				</body></html>` );
				expect(
					await page.evaluate( () => typeof ( document.getElementById( 'z1' ) as HTMLElement ).click )
				).toBe( 'undefined' );
				const states = await captureSelectableSetStates( page );
				expect( states ).toHaveLength( 3 );
				expect( states.every( ( state ) => state.status === 'captured' ) ).toBe( true );
				expect( states.map( ( state ) => state.trigger.id ) ).toEqual( [ 'z1', 'z2', 'z3' ] );
				expect( states[ 0 ].set ).toEqual( { selector: '#map', size: 3, index: 0 } );
				expect( states[ 0 ].dialog?.html ).toContain( 'Flower Room 1 / Production' );
				expect( states[ 1 ].dialog?.html ).toContain( 'Flower Room 2 / Production' );
				expect( states[ 2 ].dialog?.html ).toContain( 'Flower Room 3 / Production' );
				expect( await page.locator( '#panel' ).textContent() ).toBe(
					'Select a zone to view details.'
				);
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'captures sibling filter chips that drive a shared card grid',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div id="layout">
						<div id="chips">
							<button type="button" id="all" class="chip on">All</button>
							<button type="button" id="sativa" class="chip">Sativa</button>
							<button type="button" id="indica" class="chip">Indica</button>
						</div>
						<div id="grid">
							<article data-type="sativa">Sativa Orangutan unique copy for the grid.</article>
							<article data-type="sativa">Sativa Sunrise unique copy for the grid.</article>
							<article data-type="indica">Indica Wedding unique copy for the grid.</article>
						</div>
					</div>
					<script>
						const chips = [...document.querySelectorAll('#chips button')];
						const grid = document.getElementById('grid');
						const cards = [...document.querySelectorAll('#grid article')].map((card) => card.cloneNode(true));
						chips.forEach((chip) => {
							chip.addEventListener('click', () => {
								chips.forEach((other) => { other.className = other === chip ? 'chip on' : 'chip'; });
								grid.replaceChildren(
									...cards
										.filter((card) => chip.id === 'all' || card.dataset.type === chip.id)
										.map((card) => card.cloneNode(true))
								);
							});
						});
					</script>
				</body></html>` );
				const states = await captureSelectableSetStates( page );
				expect( states.map( ( state ) => [ state.trigger.id, state.status ] ) ).toEqual( [
					[ 'all', 'captured' ],
					[ 'sativa', 'captured' ],
					[ 'indica', 'captured' ],
				] );
				expect( states[ 0 ].set ).toEqual( { selector: '#chips', size: 3, index: 0 } );
				expect( states[ 0 ].dialog?.id ).toBe( 'grid' );
				expect( states[ 1 ].dialog?.html ).toContain( 'Sativa Orangutan' );
				expect( states[ 1 ].dialog?.html ).not.toContain( 'Indica Wedding' );
				expect( states[ 2 ].dialog?.html ).toContain( 'Indica Wedding' );
				expect( states[ 2 ].dialog?.html ).not.toContain( 'Sativa Orangutan' );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'captures icon-only choice transitions that mutate styles inside their labeled group',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( ICON_CHOICE_PAGE );
				const states = await captureSelectableSetStates( page );
				expect( states ).toHaveLength( 5 );
				expect( states.every( ( state ) => state.kind === 'choice-group' && state.status === 'captured' ) ).toBe( true );
				expect( states.map( ( state ) => state.choiceGroup?.transition.selectedIndex ) ).toEqual( [ 0, 1, 2, 3, 4 ] );
				expect( states[ 0 ].choiceGroup ).toMatchObject( {
					group: { id: 'rating-choices', label: 'Rating', labelSelector: '#rating-label', formSelector: '#feedback' },
					choices: [ { index: 0, value: null }, { index: 1, value: null }, { index: 2, value: null }, { index: 3, value: null }, { index: 4, value: null } ],
				} );
				expect( states[ 0 ].choiceGroup?.transition.html ).toContain( 'fill: none' );
				expect( states[ 1 ].choiceGroup?.transition.html ).toContain( 'data-star="1"' );
				expect( await page.evaluate( () => ( window as typeof window & { submits: number } ).submits ) ).toBe( 0 );
				expect( await page.locator( '#rating-choices svg' ).evaluateAll( ( svgs ) => svgs.map( ( svg ) => svg.style.fill ) ) ).toEqual(
					[ 'rgb(251, 191, 36)', 'rgb(251, 191, 36)', 'rgb(251, 191, 36)', 'rgb(251, 191, 36)', 'rgb(251, 191, 36)' ]
				);
				await page.locator( '#rating-choices button' ).first().click();
				expect( await page.locator( '#rating-choices svg' ).evaluateAll( ( svgs ) => svgs.map( ( svg ) => svg.style.fill ) ) ).toEqual(
					[ 'rgb(251, 191, 36)', 'none', 'none', 'none', 'none' ]
				);
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'keeps independent toggles explicit and restores them through source actions',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( INDEPENDENT_TOGGLE_PAGE );
				const states = await captureSelectableSetStates( page, { settleMs: 20, maxDriveMs: 3_000 } );
				expect( states ).toHaveLength( 3 );
				expect( states.every( ( state ) => state.kind === 'choice-group' && state.choiceGroup?.replay === 'unsupported' ) ).toBe( true );
				expect( states.every( ( state ) => state.choiceGroup?.restoration === 'verified' ) ).toBe( true );
				expect( states.every( ( state ) => state.choiceGroup?.coverage === 'complete' ) ).toBe( true );
				expect( states.map( ( state ) => state.choiceGroup?.transition.selected ) ).toEqual( [
					[ true, false, false ],
					[ false, true, false ],
					[ false, false, true ],
				] );
				await page.locator( '#toggles button' ).first().click();
				expect( await page.locator( '#toggles button' ).evaluateAll( ( buttons ) => buttons.map( ( button ) => button.getAttribute( 'aria-pressed' ) ) ) ).toEqual( [ 'true', 'false', 'false' ] );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'restores closure-backed activation-determined choices through the source lifecycle',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( CLOSURE_ABSOLUTE_PAGE );
				const states = await captureSelectableSetStates( page, { settleMs: 20, maxDriveMs: 3_000 } );
				expect( states ).toHaveLength( 3 );
				expect( states.every( ( state ) => state.choiceGroup?.replay === 'activation-determined' ) ).toBe( true );
				expect( states.every( ( state ) => state.choiceGroup?.restoration === 'verified' ) ).toBe( true );
				expect( states.every( ( state ) => state.choiceGroup?.coverage === 'complete' ) ).toBe( true );
				expect( await page.evaluate( () => ( window as typeof window & { choiceState: number } ).choiceState ) ).toBe( 0 );
				await page.locator( '#absolute button' ).nth( 2 ).click();
				expect( await page.evaluate( () => ( window as typeof window & { choiceState: number } ).choiceState ) ).toBe( 2 );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'rejects replay for a history-dependent group instead of exporting a wrong transition',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( HISTORY_DEPENDENT_PAGE );
				const states = await captureSelectableSetStates( page, { settleMs: 20, maxDriveMs: 3_000 } );
				expect( states ).toHaveLength( 1 );
				expect( states[ 0 ] ).toMatchObject( {
					status: 'captured',
					kind: 'choice-group',
					choiceGroup: {
						replay: 'unsupported',
						restoration: 'unverified',
						coverage: 'partial',
					},
				} );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'records no-dialog with a reason when a weak button set does not mutate a region',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><html><body>
					<div id="layout">
						<div id="chips">
							<button type="button" id="a">Alpha</button>
							<button type="button" id="b">Beta</button>
							<button type="button" id="c">Gamma</button>
						</div>
						<div id="panel">Static copy that never changes for any chip.</div>
					</div>
				</body></html>` );
				const states = await captureSelectableSetStates( page );
				expect( states ).toHaveLength( 1 );
				expect( states[ 0 ] ).toMatchObject( {
					status: 'no-dialog',
					kind: SELECTABLE_SET_KIND,
					trigger: { id: 'a' },
					set: { size: 3, index: 0 },
					error: 'shared region did not vary',
				} );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'does not drive a pointer-cursor tile that a real link wraps',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			const navigations: string[] = [];
			page.on( 'framenavigated', ( frame ) => navigations.push( frame.url() ) );
			try {
				await serve( page, LINK_WRAPPED_CARDS_PAGE );
				expect( await captureSelectableSetStates( page ) ).toEqual( [] );
				expect( navigations ).toEqual( [ `${ ORIGIN }/` ] );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'leaves the page and its cleanup evidence intact while driving a set beside link-wrapped cards',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			const navigations: string[] = [];
			page.on( 'framenavigated', ( frame ) => navigations.push( frame.url() ) );
			try {
				await serve( page, CARDS_BESIDE_PICKER_PAGE );
				await applySourceCleanup( page, cleanupPolicy() );
				const states = await captureSelectableSetStates( page );
				expect( states.map( ( state ) => [ state.trigger.id, state.status ] ) ).toEqual( [
					[ 'z1', 'captured' ],
					[ 'z2', 'captured' ],
					[ 'z3', 'captured' ],
				] );
				expect( navigations ).toEqual( [ `${ ORIGIN }/` ] );
				await expect( readSourceCleanup( page ) ).resolves.toMatchObject( { failures: [] } );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'keeps the page when a member has no href and its own handler follows a link',
		async () => {
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			const navigations: string[] = [];
			page.on( 'framenavigated', ( frame ) => navigations.push( frame.url() ) );
			try {
				await serve( page, SCRIPTED_LINK_TILES_PAGE );
				const states = await captureSelectableSetStates( page );
				expect( states ).toEqual( [
					expect.objectContaining( {
						status: 'no-dialog',
						kind: SELECTABLE_SET_KIND,
						set: { selector: '#tiles', size: 3, index: 0 },
						error: 'shared region did not vary',
					} ),
				] );
				expect( navigations ).toEqual( [ `${ ORIGIN }/` ] );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'still drives a set whose members change the region through a default action',
		async () => {
			// Only the follow-through that navigates may be cancelled. A label
			// checking its own radio is a default action too, and here it is the
			// only thing that changes the region.
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await serve( page, LABEL_FILTER_PAGE );
				const states = await captureSelectableSetStates( page );
				expect( states.map( ( state ) => [ state.trigger.id, state.status ] ) ).toEqual( [
					[ 'f1', 'captured' ],
					[ 'f2', 'captured' ],
					[ 'f3', 'captured' ],
				] );
				expect( states[ 1 ].dialog?.html ).toContain( 'Beta strains' );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it.skipIf( skipBrowser )(
		'reports a scripted navigation rather than claiming the member was captured',
		async () => {
			// `location.assign` is not a default action, so no listener can cancel
			// it. What must hold is that the loss is reported: a route that lost its
			// page is evidence of a gap, and silently recording `captured` for a
			// member whose region was never observed would hide one.
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await serve( page, SCRIPTED_ASSIGN_TILES_PAGE );
				const states = await captureSelectableSetStates( page );
				expect( states ).toEqual( [
					expect.objectContaining( { status: 'click-failed', kind: SELECTABLE_SET_KIND } ),
				] );
			} finally {
				await page.close();
			}
		},
		30_000
	);

	it( 'exposes explicit drive caps', () => {
		expect( SELECTABLE_SET_LIMITS ).toEqual( {
			maxSets: 3,
			maxMembers: 24,
			maxDriveMs: 16_000,
			maxHtmlBytes: 512 * 1024,
			settleMs: 500,
			maxCandidateScan: 1_500,
			maxPointerCandidates: 80,
			maxProbeGroups: 9,
		} );
	} );
} );
