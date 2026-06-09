import path from 'path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'fs-extra';
import { E2ESession } from '../../../apps/studio/e2e/e2e-helpers';
import { median } from '../utils';

interface FrameMetric {
	frameCount: number;
	p95FrameGap: number;
	maxFrameGap: number;
	droppedFrames: number;
	longTaskCount: number;
	longTaskTotal: number;
}

type MetricPrefix =
	| 'sidebarCollapse'
	| 'sidebarExpand'
	| 'previewOpen'
	| 'previewClose'
	| 'chatListOpen'
	| 'chatListClose'
	| 'navigateToChat'
	| 'navigateToSite';

const FRAME_BUDGET_MS = 16.67;
const SAMPLE_MS = Number.parseInt( process.env.UI_CLASSIC_PANEL_SAMPLE_MS || '400', 10 );
const RUNS = Number.parseInt( process.env.UI_CLASSIC_PANEL_RUNS || '7', 10 );
const SITE_COUNT = Number.parseInt( process.env.UI_CLASSIC_PANEL_SITE_COUNT || '1', 10 );
const RUNNING_SITE_COUNT = Number.parseInt(
	process.env.UI_CLASSIC_PANEL_RUNNING_SITE_COUNT || '1',
	10
);
const SESSIONS_PER_SITE = Number.parseInt(
	process.env.UI_CLASSIC_PANEL_SESSIONS_PER_SITE || '0',
	10
);
const KEEP_PREVIEW_OPEN = process.env.UI_CLASSIC_PANEL_KEEP_PREVIEW_OPEN === 'true';
const MEASURE_NAVIGATION = process.env.UI_CLASSIC_PANEL_MEASURE_NAVIGATION === 'true';

function roundMetric( value: number ): number {
	return Math.round( value * 10 ) / 10;
}

function getButton( page: Page, name: string ): Locator {
	return page.getByRole( 'button', { name, exact: true } );
}

function shortId(): string {
	return Math.random().toString( 36 ).slice( 2, 10 );
}

async function readLastEntryId( filePath: string ): Promise< string | null > {
	const content = await fs.readFile( filePath, 'utf8' );
	const lines = content
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( Boolean );

	for ( let index = lines.length - 1; index >= 0; index-- ) {
		try {
			const entry = JSON.parse( lines[ index ] ) as { id?: unknown };
			if ( typeof entry.id === 'string' ) {
				return entry.id;
			}
		} catch {
			return null;
		}
	}

	return null;
}

async function appendSyntheticTurn(
	filePath: string,
	siteName: string,
	sessionIndex: number
): Promise< void > {
	const timestamp = new Date().toISOString();
	const promptId = shortId();
	const assistantId = shortId();
	const closedId = shortId();
	const parentId = await readLastEntryId( filePath );
	const prompt = `Synthetic prompt ${ sessionIndex } for ${ siteName }`;
	const reply = `Synthetic reply ${ sessionIndex } for ${ siteName }. `.repeat( 4 ).trim();
	const entries = [
		{
			type: 'custom',
			id: promptId,
			parentId,
			timestamp,
			customType: 'studio.user_prompt',
			data: { source: 'prompt', text: prompt },
		},
		{
			type: 'message',
			id: assistantId,
			parentId: promptId,
			timestamp,
			message: {
				role: 'assistant',
				content: [ { type: 'text', text: reply } ],
			},
		},
		{
			type: 'custom',
			id: closedId,
			parentId: assistantId,
			timestamp,
			customType: 'studio.turn_closed',
			data: { status: 'success' },
		},
	];

	await fs.appendFile(
		filePath,
		entries.map( ( entry ) => JSON.stringify( entry ) ).join( '\n' ) + '\n',
		'utf8'
	);
}

async function switchToClassicMode( page: Page ) {
	if (
		await page
			.locator( '[data-ui-mode="classic"]' )
			.isVisible( { timeout: 1000 } )
			.catch( () => false )
	) {
		return;
	}

	await page.evaluate( async () => {
		await (
			window as Window & { ipcApi: { setStudioUiMode: ( mode: string ) => Promise< void > } }
		 ).ipcApi.setStudioUiMode( 'agentic' );
	} );
	await page.locator( '[data-ui-mode="classic"]' ).waitFor( { timeout: 60_000 } );
}

async function createSiteForPanelMetrics( session: E2ESession ) {
	const sitesRoot = path.join( session.homePath, 'Studio' );
	const sitePath = path.join( sitesRoot, 'ui-classic-panel-metrics' );
	await fs.mkdir( sitesRoot, { recursive: true } );

	const primarySite = await session.mainWindow.evaluate(
		async ( { localPath } ) => {
			return (
				window as Window & {
					ipcApi: {
						createSite: (
							path: string,
							config: {
								siteName: string;
								adminUsername: string;
								adminPassword: string;
								adminEmail: string;
								noStart?: boolean;
							}
						) => Promise< { id: string; name: string } >;
					};
				}
			 ).ipcApi.createSite( localPath, {
				siteName: 'UI Classic Panel Metrics',
				adminUsername: 'admin',
				adminPassword: 'password',
				adminEmail: 'admin@localhost.com',
			} );
		},
		{ localPath: sitePath }
	);

	const createSessions = async ( siteId: string, siteName: string ) => {
		for ( let sessionIndex = 0; sessionIndex < SESSIONS_PER_SITE; sessionIndex++ ) {
			const created = await session.mainWindow.evaluate( async ( id ) => {
				return (
					window as Window & {
						ipcApi: {
							createAiSession: ( siteId: string ) => Promise< { id: string; filePath: string } >;
						};
					}
				 ).ipcApi.createAiSession( id );
			}, siteId );
			await appendSyntheticTurn( created.filePath, siteName, sessionIndex + 1 );
		}
	};

	await createSessions( primarySite.id, primarySite.name );

	for ( let index = 2; index <= SITE_COUNT; index++ ) {
		const extraSitePath = path.join( sitesRoot, `ui-classic-panel-metrics-${ index }` );
		const noStart = index > RUNNING_SITE_COUNT;
		const extraSite = await session.mainWindow.evaluate(
			async ( { localPath, siteName, noStart: shouldSkipStart } ) => {
				return (
					window as Window & {
						ipcApi: {
							createSite: (
								path: string,
								config: {
									siteName: string;
									adminUsername: string;
									adminPassword: string;
									adminEmail: string;
									noStart?: boolean;
								}
							) => Promise< { id: string; name: string } >;
						};
					}
				 ).ipcApi.createSite( localPath, {
					siteName,
					adminUsername: 'admin',
					adminPassword: 'password',
					adminEmail: 'admin@localhost.com',
					noStart: shouldSkipStart,
				} );
			},
			{ localPath: extraSitePath, siteName: `UI Classic Panel Metrics ${ index }`, noStart }
		);
		await createSessions( extraSite.id, extraSite.name );
	}

	return primarySite;
}

async function navigateToSiteOverview( page: Page, siteId: string ): Promise< boolean > {
	await page.evaluate( ( id ) => {
		window.location.hash = `#/sites/${ id }`;
	}, siteId );
	// Probe with a short timeout instead of asserting: builds without the
	// ui-classic browser preview (e.g. the trunk baseline compare-perf builds
	// against) never render this control, so we skip the suite rather than
	// hang for 60s and fail the whole metrics job.
	return getButton( page, 'Show browser' )
		.waitFor( { state: 'visible', timeout: 15_000 } )
		.then( () => true )
		.catch( () => false );
}

async function warmPreviewPanel( page: Page ) {
	await getButton( page, 'Show browser' ).click();
	await expect( getButton( page, 'Hide browser' ) ).toBeVisible( { timeout: 60_000 } );
	await page.getByLabel( 'Site preview' ).waitFor( { state: 'attached', timeout: 60_000 } );
	await page.waitForTimeout( 1200 );
	if ( ! KEEP_PREVIEW_OPEN ) {
		await getButton( page, 'Hide browser' ).click();
		await expect( getButton( page, 'Show browser' ) ).toBeVisible( { timeout: 60_000 } );
		await page.waitForTimeout( 300 );
	}
}

async function measureInteraction(
	page: Page,
	action: () => Promise< void >
): Promise< FrameMetric > {
	await page.evaluate(
		( { sampleMs, frameBudgetMs } ) => {
			const runtimeWindow = window as Window & {
				__uiClassicPanelMeasure?: Promise< FrameMetric >;
			};

			runtimeWindow.__uiClassicPanelMeasure = new Promise< FrameMetric >( ( resolve ) => {
				const frameGaps: number[] = [];
				const longTasks: number[] = [];
				let previousFrameTime = performance.now();
				const startTime = previousFrameTime;
				let observer: PerformanceObserver | undefined;

				try {
					if (
						'PerformanceObserver' in window &&
						PerformanceObserver.supportedEntryTypes?.includes( 'longtask' )
					) {
						observer = new PerformanceObserver( ( list ) => {
							for ( const entry of list.getEntries() ) {
								longTasks.push( entry.duration );
							}
						} );
						observer.observe( { entryTypes: [ 'longtask' ] } );
					}
				} catch {
					observer = undefined;
				}

				const finish = () => {
					observer?.disconnect();
					const sorted = [ ...frameGaps ].sort( ( a, b ) => a - b );
					const p95Index = Math.max( 0, Math.ceil( sorted.length * 0.95 ) - 1 );
					const droppedFrames = frameGaps.reduce(
						( total, gap ) => total + Math.max( 0, Math.round( gap / frameBudgetMs ) - 1 ),
						0
					);
					resolve( {
						frameCount: frameGaps.length,
						p95FrameGap: sorted[ p95Index ] ?? 0,
						maxFrameGap: sorted[ sorted.length - 1 ] ?? 0,
						droppedFrames,
						longTaskCount: longTasks.length,
						longTaskTotal: longTasks.reduce( ( total, duration ) => total + duration, 0 ),
					} );
				};

				const tick = ( now: number ) => {
					frameGaps.push( now - previousFrameTime );
					previousFrameTime = now;
					if ( now - startTime >= sampleMs ) {
						finish();
						return;
					}
					requestAnimationFrame( tick );
				};

				requestAnimationFrame( tick );
			} );
		},
		{ sampleMs: SAMPLE_MS, frameBudgetMs: FRAME_BUDGET_MS }
	);

	await action();
	const metric = await page.evaluate( () => {
		const runtimeWindow = window as Window & {
			__uiClassicPanelMeasure?: Promise< FrameMetric >;
		};
		return runtimeWindow.__uiClassicPanelMeasure;
	} );
	await page.waitForTimeout( 100 );
	return metric;
}

function addMetrics(
	results: Record< string, number[] >,
	raw: Record< string, FrameMetric[] >,
	prefix: MetricPrefix,
	metric: FrameMetric
) {
	raw[ prefix ] ??= [];
	raw[ prefix ].push( metric );
	results[ `${ prefix }P95FrameGap` ] ??= [];
	results[ `${ prefix }MaxFrameGap` ] ??= [];
	results[ `${ prefix }DroppedFrames` ] ??= [];
	results[ `${ prefix }P95FrameGap` ].push( roundMetric( metric.p95FrameGap ) );
	results[ `${ prefix }MaxFrameGap` ].push( roundMetric( metric.maxFrameGap ) );
	results[ `${ prefix }DroppedFrames` ].push( metric.droppedFrames );

	if ( prefix === 'previewOpen' || prefix === 'previewClose' ) {
		results[ `${ prefix }LongTaskTotal` ] ??= [];
		results[ `${ prefix }LongTaskTotal` ].push( roundMetric( metric.longTaskTotal ) );
	}
}

test.describe( 'UI Classic Panel Metrics', () => {
	const session = new E2ESession();
	// Whether this build exposes the ui-classic browser preview. Set during
	// setup; when false (e.g. the trunk baseline build) the measurement test
	// skips instead of failing.
	let panelsAvailable = true;
	const results: Record< string, number[] > = {
		sidebarCollapseP95FrameGap: [],
		sidebarCollapseMaxFrameGap: [],
		sidebarCollapseDroppedFrames: [],
		sidebarExpandP95FrameGap: [],
		sidebarExpandMaxFrameGap: [],
		sidebarExpandDroppedFrames: [],
		previewOpenP95FrameGap: [],
		previewOpenMaxFrameGap: [],
		previewOpenDroppedFrames: [],
		previewOpenLongTaskTotal: [],
		previewCloseP95FrameGap: [],
		previewCloseMaxFrameGap: [],
		previewCloseDroppedFrames: [],
		previewCloseLongTaskTotal: [],
		chatListOpenP95FrameGap: [],
		chatListOpenMaxFrameGap: [],
		chatListOpenDroppedFrames: [],
		chatListCloseP95FrameGap: [],
		chatListCloseMaxFrameGap: [],
		chatListCloseDroppedFrames: [],
		navigateToChatP95FrameGap: [],
		navigateToChatMaxFrameGap: [],
		navigateToChatDroppedFrames: [],
		navigateToSiteP95FrameGap: [],
		navigateToSiteMaxFrameGap: [],
		navigateToSiteDroppedFrames: [],
	};
	const raw: Record< string, FrameMetric[] > = {
		sidebarCollapse: [],
		sidebarExpand: [],
		previewOpen: [],
		previewClose: [],
		chatListOpen: [],
		chatListClose: [],
		navigateToChat: [],
		navigateToSite: [],
	};

	test.beforeAll( async () => {
		await session.launch();
		await switchToClassicMode( session.mainWindow );
		const site = await createSiteForPanelMetrics( session );
		await session.mainWindow.reload( { waitUntil: 'domcontentloaded' } );
		await switchToClassicMode( session.mainWindow );
		panelsAvailable = await navigateToSiteOverview( session.mainWindow, site.id );
		if ( ! panelsAvailable ) {
			return;
		}
		await warmPreviewPanel( session.mainWindow );
	} );

	// eslint-disable-next-line no-empty-pattern
	test.afterAll( async ( {}, testInfo ) => {
		const medians: Record< string, number > = {};
		for ( const metric of Object.keys( results ) ) {
			if ( results[ metric ].length === 0 ) {
				continue;
			}
			medians[ metric ] = median( results[ metric ] );
		}

		await testInfo.attach( 'results', {
			body: JSON.stringify( medians, null, 2 ),
			contentType: 'application/json',
		} );
		await testInfo.attach( 'raw-results', {
			body: JSON.stringify( raw, null, 2 ),
			contentType: 'application/json',
		} );

		await session.cleanup();
		setTimeout( () => process.exit( 0 ), 1000 );
	} );

	test( 'measure sidebar and preview panel toggle frame pacing', async () => {
		test.skip( ! panelsAvailable, 'ui-classic browser preview is unavailable on this build' );
		for ( let index = 0; index < RUNS; index++ ) {
			await test.step( `Run ${ index + 1 }/${ RUNS }: sidebar collapse/expand`, async () => {
				addMetrics(
					results,
					raw,
					'sidebarCollapse',
					await measureInteraction( session.mainWindow, () =>
						getButton( session.mainWindow, 'Hide sidebar' ).click()
					)
				);
				await expect( getButton( session.mainWindow, 'Show sidebar' ) ).toBeVisible();

				addMetrics(
					results,
					raw,
					'sidebarExpand',
					await measureInteraction( session.mainWindow, () =>
						getButton( session.mainWindow, 'Show sidebar' ).click()
					)
				);
				await expect( getButton( session.mainWindow, 'Hide sidebar' ) ).toBeVisible();
			} );

			await test.step( `Run ${ index + 1 }/${ RUNS }: preview open/close`, async () => {
				if ( KEEP_PREVIEW_OPEN ) {
					addMetrics(
						results,
						raw,
						'previewClose',
						await measureInteraction( session.mainWindow, () =>
							getButton( session.mainWindow, 'Hide browser' ).click()
						)
					);
					await expect( getButton( session.mainWindow, 'Show browser' ) ).toBeVisible();

					addMetrics(
						results,
						raw,
						'previewOpen',
						await measureInteraction( session.mainWindow, () =>
							getButton( session.mainWindow, 'Show browser' ).click()
						)
					);
					await expect( getButton( session.mainWindow, 'Hide browser' ) ).toBeVisible();
					return;
				}

				addMetrics(
					results,
					raw,
					'previewOpen',
					await measureInteraction( session.mainWindow, () =>
						getButton( session.mainWindow, 'Show browser' ).click()
					)
				);
				await expect( getButton( session.mainWindow, 'Hide browser' ) ).toBeVisible();

				addMetrics(
					results,
					raw,
					'previewClose',
					await measureInteraction( session.mainWindow, () =>
						getButton( session.mainWindow, 'Hide browser' ).click()
					)
				);
				await expect( getButton( session.mainWindow, 'Show browser' ) ).toBeVisible();
			} );

			if ( SESSIONS_PER_SITE > 0 ) {
				await test.step( `Run ${ index + 1 }/${ RUNS }: chat list open/close`, async () => {
					addMetrics(
						results,
						raw,
						'chatListClose',
						await measureInteraction( session.mainWindow, () =>
							getButton( session.mainWindow, 'Hide chats' ).first().click()
						)
					);
					await expect( getButton( session.mainWindow, 'Show chats' ).first() ).toBeVisible();

					addMetrics(
						results,
						raw,
						'chatListOpen',
						await measureInteraction( session.mainWindow, () =>
							getButton( session.mainWindow, 'Show chats' ).first().click()
						)
					);
					await expect( getButton( session.mainWindow, 'Hide chats' ).first() ).toBeVisible();
				} );
			}

			if ( MEASURE_NAVIGATION && SESSIONS_PER_SITE > 0 ) {
				await test.step( `Run ${ index + 1 }/${ RUNS }: site/chat navigation`, async () => {
					const chatLink = session.mainWindow.locator( 'a[href*="/sessions/"]' ).first();
					await expect( chatLink ).toBeVisible();
					addMetrics(
						results,
						raw,
						'navigateToChat',
						await measureInteraction( session.mainWindow, () => chatLink.click() )
					);
					await session.mainWindow.waitForFunction(
						() => window.location.hash.includes( '/sessions/' ),
						undefined,
						{ timeout: 60_000 }
					);

					const siteButton = session.mainWindow
						.getByRole( 'button', {
							name: 'View UI Classic Panel Metrics site details',
							exact: true,
						} )
						.first();
					await expect( siteButton ).toBeVisible();
					addMetrics(
						results,
						raw,
						'navigateToSite',
						await measureInteraction( session.mainWindow, () => siteButton.click() )
					);
					await session.mainWindow.waitForFunction(
						() => window.location.hash.includes( '/sites/' ),
						undefined,
						{ timeout: 60_000 }
					);
				} );
			}
		}
	} );
} );
