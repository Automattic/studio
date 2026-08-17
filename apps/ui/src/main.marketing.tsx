import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { queryClient } from '@/data/core';
import { persister, persistPromise } from '@/data/core/query-client';
import { applyLocale } from '@/lib/apply-locale';
import {
	applyMarketingPanelLayout,
	createMarketingConnector,
	getMarketingScenario,
	resolveMarketingPanelLayout,
} from '@/marketing';
import '@/marketing.css';
import type { AppliedMarketingPanelLayout } from '@/marketing';

declare global {
	interface Window {
		__STUDIO_MARKETING_SCREENSHOT_READY__?: boolean;
		__STUDIO_MARKETING_PANEL_LAYOUT__?: AppliedMarketingPanelLayout;
	}
}

type MarketingTheme = 'light' | 'dark';

const READY_TIMEOUT_MS = 20_000;

function getTheme( value: string | null ): MarketingTheme {
	if ( value === null ) {
		return 'light';
	}
	if ( value === 'light' || value === 'dark' ) {
		return value;
	}
	throw new Error( `Unknown marketing screenshot theme: ${ value }` );
}

function getPreviewOrigin( value: string | null ): string | undefined {
	if ( value === null ) {
		return undefined;
	}
	const origin = new URL( value );
	if ( origin.protocol !== 'http:' || ! [ '127.0.0.1', 'localhost' ].includes( origin.hostname ) ) {
		throw new Error( 'Marketing preview origin must be an HTTP loopback address.' );
	}
	return origin.origin;
}

function nextPaint(): Promise< void > {
	return new Promise( ( resolve ) => {
		requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) );
	} );
}

function waitForSelector( selector: string, label: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const findElement = () => document.querySelector( selector );
		if ( findElement() ) {
			resolve();
			return;
		}

		const timeout = window.setTimeout( () => {
			observer.disconnect();
			reject( new Error( `Timed out waiting for ${ label } (${ selector }).` ) );
		}, READY_TIMEOUT_MS );
		const observer = new MutationObserver( () => {
			if ( ! findElement() ) {
				return;
			}
			window.clearTimeout( timeout );
			observer.disconnect();
			resolve();
		} );
		observer.observe( document.body, { childList: true, subtree: true } );
	} );
}

function waitForQueriesToSettle(): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		let checkingIdle = false;
		const timeout = window.setTimeout( () => {
			unsubscribe();
			reject( new Error( 'Timed out waiting for marketing scenario queries.' ) );
		}, READY_TIMEOUT_MS );

		const finishIfIdle = () => {
			if ( checkingIdle || queryClient.isFetching() > 0 || queryClient.isMutating() > 0 ) {
				return;
			}
			checkingIdle = true;
			void nextPaint().then( () => {
				checkingIdle = false;
				if ( queryClient.isFetching() > 0 || queryClient.isMutating() > 0 ) {
					return;
				}
				window.clearTimeout( timeout );
				unsubscribe();
				resolve();
			} );
		};

		const unsubscribe = queryClient.getQueryCache().subscribe( finishIfIdle );
		finishIfIdle();
	} );
}

async function waitForImages(): Promise< void > {
	await Promise.all(
		Array.from( document.images, ( image ) => {
			if ( image.complete ) {
				return Promise.resolve();
			}
			return new Promise< void >( ( resolve ) => {
				image.addEventListener( 'load', () => resolve(), { once: true } );
				image.addEventListener( 'error', () => resolve(), { once: true } );
			} );
		} )
	);
}

function isFrameReady( frame: HTMLIFrameElement ): boolean {
	try {
		return (
			frame.contentWindow?.location.href !== 'about:blank' &&
			frame.contentDocument?.readyState === 'complete'
		);
	} catch {
		return false;
	}
}

async function waitForFrames(): Promise< void > {
	await Promise.all(
		Array.from( document.querySelectorAll< HTMLIFrameElement >( 'iframe' ), ( frame ) => {
			if ( isFrameReady( frame ) ) {
				return Promise.resolve();
			}
			return new Promise< void >( ( resolve, reject ) => {
				let timeout = 0;
				const handleLoad = () => {
					window.clearTimeout( timeout );
					resolve();
				};
				frame.addEventListener( 'load', handleLoad, { once: true } );
				timeout = window.setTimeout( () => {
					frame.removeEventListener( 'load', handleLoad );
					reject( new Error( `Timed out waiting for preview frame ${ frame.src }.` ) );
				}, READY_TIMEOUT_MS );
				if ( isFrameReady( frame ) ) {
					frame.removeEventListener( 'load', handleLoad );
					handleLoad();
				}
			} );
		} )
	);
}

async function markReady( readySelector: string ): Promise< void > {
	await waitForSelector( '[data-ui-mode="classic"]', 'the Studio app shell' );
	await waitForSelector( readySelector, 'the marketing scenario content' );
	await waitForQueriesToSettle();
	await document.fonts?.ready;
	await waitForImages();
	await waitForFrames();
	await nextPaint();

	document.documentElement.dataset.marketingScreenshotReady = 'true';
	window.__STUDIO_MARKETING_SCREENSHOT_READY__ = true;
}

async function bootstrap() {
	document.documentElement.dataset.marketingScreenshotReady = 'false';
	window.__STUDIO_MARKETING_SCREENSHOT_READY__ = false;

	const requestedUrl = new URL( window.location.href );
	const scenario = getMarketingScenario(
		requestedUrl.searchParams.get( 'scenario' ) ?? 'add-site'
	);
	const theme = getTheme( requestedUrl.searchParams.get( 'theme' ) );
	const panelLayout = resolveMarketingPanelLayout(
		scenario.panelLayout,
		requestedUrl.searchParams
	);
	const previewOrigin = getPreviewOrigin( requestedUrl.searchParams.get( 'previewOrigin' ) );
	const annotatePreview = requestedUrl.searchParams.get( 'annotatePreview' ) === 'true';

	document.documentElement.dataset.marketingScreenshotScenario = scenario.id;
	document.documentElement.dataset.marketingScreenshotTheme = theme;

	await persistPromise;
	await persister.removeClient();
	queryClient.clear();
	window.localStorage.clear();
	const appliedPanelLayout = applyMarketingPanelLayout( panelLayout, window.innerWidth );
	window.__STUDIO_MARKETING_PANEL_LAYOUT__ = appliedPanelLayout;

	const connector = createMarketingConnector( scenario, theme, panelLayout, {
		previewOrigin,
		annotatePreview,
	} );
	await Promise.all( [ connector.init?.(), applyLocale( connector ) ] );

	const scenarioUrl = new URL( scenario.route, window.location.origin );
	scenarioUrl.searchParams.set( 'scenario', scenario.id );
	scenarioUrl.searchParams.set( 'theme', theme );
	scenarioUrl.searchParams.set( 'sidebar', panelLayout.sidebar.state );
	scenarioUrl.searchParams.set( 'sidebarWidth', String( panelLayout.sidebar.width ) );
	scenarioUrl.searchParams.set( 'preview', panelLayout.preview.state );
	scenarioUrl.searchParams.set( 'previewWidthRatio', String( panelLayout.preview.widthRatio ) );
	window.history.replaceState( null, '', `${ scenarioUrl.pathname }${ scenarioUrl.search }` );

	createRoot( document.getElementById( 'root' )! ).render(
		<App connector={ connector } forcedMode="classic" />
	);

	await markReady( scenario.readySelector );
}

void bootstrap().catch( ( error: unknown ) => {
	const message = error instanceof Error ? error.message : String( error );
	document.documentElement.dataset.marketingScreenshotError = message;
	console.error( '[marketing-screenshot]', error );
} );
