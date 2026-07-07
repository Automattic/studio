/**
 * Opens a headed Playwright browser on a Studio site with the shared Studio
 * clip inspector injected (`@studio/common/inspector` — the same script the
 * desktop preview runs, configured for standalone use).
 *
 * The user clips elements (⌘-click or the "Clip" toggle), drags regions,
 * and clicks "Send to agent" when done. This module is the host side of the
 * inspector protocol: it listens to the page's console bridge, takes the
 * screenshots the guest can't take of itself (via Playwright), keeps the
 * clip list, and mirrors it back into the page as numbered markers.
 *
 * Hand-off to the agent: on submit the host writes the result onto
 * `window.__studioAnnotateDone`, which `waitForAnnotationsDone()` polls for
 * (same contract as the previous annotation inspector).
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildInspectorCommandScript,
	buildInspectorPageScript,
	parseInspectorGuestEvent,
	type ClipDocumentRect,
	type ClipMarker,
	type InspectorGuestEvent,
} from '@studio/common/inspector';
import { launchChromiumWithInstall } from 'cli/ai/browser-utils';

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

const CLI_INSPECTOR_SCRIPT = buildInspectorPageScript( {
	features: {
		elementClips: true,
		regionClips: true,
		pageClips: true,
		// The loupe needs a host that streams viewport backdrops; the CLI
		// host doesn't implement that (yet), so it stays off here.
		loupe: false,
		contextMenu: true,
		// No host toolbar to receive them.
		browserShortcuts: false,
		// Standalone chrome: clip count + "Send to agent" button.
		submitToolbar: true,
	},
} );

interface CliClip {
	id: string;
	grain: string;
	comment?: string;
	target?: unknown;
	documentRect?: ClipDocumentRect;
	zoom?: number;
	coveredTag?: string;
	coveredSelector?: string;
	url?: string;
	pathname?: string;
	// Screenshot of the clipped element/region/page, written to a temp file
	// the agent can read.
	imagePath?: string;
	timestamp: number;
}

let inspectorBrowser: Browser | null = null;
let inspectorPage: Page | null = null;
let processExitHookInstalled = false;
let clips: CliClip[] = [];
let clipCounter = 0;
let screenshotDir: string | null = null;

async function shutdownBrowser(): Promise< void > {
	const browser = inspectorBrowser;
	inspectorBrowser = null;
	inspectorPage = null;
	clips = [];
	if ( browser ) {
		await browser.close().catch( () => undefined );
	}
}

function installProcessExitHook(): void {
	if ( processExitHookInstalled ) {
		return;
	}
	processExitHookInstalled = true;
	// Tear down the chromium process when the CLI exits so its dock icon
	// doesn't linger on macOS.
	const cleanup = () => {
		void shutdownBrowser();
	};
	process.once( 'exit', cleanup );
	process.once( 'SIGINT', cleanup );
	process.once( 'SIGTERM', cleanup );
	process.once( 'SIGHUP', cleanup );
}

async function getScreenshotDir(): Promise< string > {
	if ( ! screenshotDir ) {
		screenshotDir = await mkdtemp( join( tmpdir(), 'studio-clips-' ) );
	}
	return screenshotDir;
}

function toClipMarkers(): ClipMarker[] {
	return clips.map( ( clip, index ) => ( {
		id: clip.id,
		number: index + 1,
		grain: clip.grain as ClipMarker[ 'grain' ],
		comment: clip.comment,
		pathname: clip.pathname,
		documentRect: clip.documentRect,
	} ) );
}

async function syncClipMarkers( page: Page ): Promise< void > {
	await page
		.evaluate( buildInspectorCommandScript( { type: 'sync-clips', clips: toClipMarkers() } ) )
		.catch( () => undefined );
}

/** Screenshot a document-coordinate rect (Playwright's clip is in page
 * coordinates), with the inspector overlay hidden so it never photographs
 * itself. */
async function captureRect(
	page: Page,
	rect: ClipDocumentRect | undefined,
	fullPage: boolean
): Promise< string | undefined > {
	try {
		await page
			.evaluate(
				'window.__studioInspectorPrepareCapture && window.__studioInspectorPrepareCapture();'
			)
			.catch( () => undefined );
		const options: Parameters< Page[ 'screenshot' ] >[ 0 ] = {
			type: 'jpeg',
			quality: 90,
			fullPage,
		};
		if ( ! fullPage ) {
			if ( ! rect || rect.width < 1 || rect.height < 1 ) {
				return undefined;
			}
			options.clip = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
		}
		const buffer = await page.screenshot( options );
		clipCounter += 1;
		const filePath = join( await getScreenshotDir(), `clip-${ clipCounter }.jpg` );
		await writeFile( filePath, buffer );
		return filePath;
	} catch {
		return undefined;
	} finally {
		await page
			.evaluate(
				'window.__studioInspectorFinishCapture && window.__studioInspectorFinishCapture();'
			)
			.catch( () => undefined );
	}
}

function newClipId(): string {
	return `clip_${ Date.now().toString( 36 ) }${ Math.random().toString( 36 ).slice( 2, 8 ) }`;
}

async function handleGuestEvent( page: Page, event: InspectorGuestEvent ): Promise< void > {
	switch ( event.type ) {
		case 'clip-element': {
			const clip = event.clip;
			const imagePath = await captureRect( page, clip.documentRect, false );
			clips.push( {
				id: newClipId(),
				grain: 'element',
				comment: clip.comment || undefined,
				target: clip.target,
				documentRect: clip.documentRect,
				url: clip.url,
				pathname: clip.pathname,
				imagePath,
				timestamp: Date.now(),
			} );
			await syncClipMarkers( page );
			return;
		}
		case 'clip-region': {
			const clip = event.clip;
			const imagePath = await captureRect( page, clip.documentRect, false );
			clips.push( {
				id: newClipId(),
				grain: 'region',
				documentRect: clip.documentRect,
				zoom: clip.zoom,
				coveredTag: clip.coveredTag,
				coveredSelector: clip.coveredSelector,
				url: clip.url,
				pathname: clip.pathname,
				imagePath,
				timestamp: Date.now(),
			} );
			await syncClipMarkers( page );
			return;
		}
		case 'clip-page': {
			const imagePath = await captureRect( page, undefined, true );
			clips.push( {
				id: newClipId(),
				grain: 'page',
				url: page.url(),
				imagePath,
				timestamp: Date.now(),
			} );
			await syncClipMarkers( page );
			return;
		}
		case 'clip-update':
			clips = clips.map( ( clip ) =>
				clip.id === event.id ? { ...clip, comment: event.comment.trim() || undefined } : clip
			);
			await syncClipMarkers( page );
			return;
		case 'clip-remove':
			clips = clips.filter( ( clip ) => clip.id !== event.id );
			await syncClipMarkers( page );
			return;
		case 'submit': {
			// Same hand-off contract as the previous annotation inspector:
			// `waitForAnnotationsDone()` polls for this window property. The
			// legacy `annotations` key carries the clips so older consumers
			// keep working.
			const result = {
				capturedAt: Date.now(),
				url: page.url(),
				annotations: clips,
			};
			await page
				.evaluate( ( value ) => {
					( window as { __studioAnnotateDone?: unknown } ).__studioAnnotateDone = value;
				}, result )
				.catch( () => undefined );
			return;
		}
	}
}

async function injectInspector( page: Page ): Promise< void > {
	// Re-evaluate the page script. The script itself is idempotent (returns
	// early via `window.__studioInspectorMounted`), but for reloads/refreshes
	// we want to ensure it runs again. To handle that we also clear the flag
	// before running, when the marker host element is missing.
	await page.evaluate( ( script: string ) => {
		// Reset the mount flag if the previous host element is gone (e.g. the
		// user navigated to a different page within the site).
		const w = window as unknown as { __studioInspectorMounted?: boolean };
		if ( ! document.getElementById( '__studio-inspector-host' ) ) {
			delete w.__studioInspectorMounted;
		}

		new Function( script )();
	}, CLI_INSPECTOR_SCRIPT );

	await page.waitForSelector( '#__studio-inspector-host', {
		timeout: 5_000,
		state: 'attached',
	} );

	await syncClipMarkers( page );
}

export interface AnnotationDoneResult {
	capturedAt: number;
	url: string;
	annotations: unknown[];
}

/**
 * Block until the user clicks "Send to agent" in the inspector, then return
 * the clips. Reads from `window.__studioAnnotateDone`, which the host
 * writes when the guest submits.
 */
export async function waitForAnnotationsDone(
	options: { timeoutMs?: number } = {}
): Promise< AnnotationDoneResult > {
	if ( ! inspectorPage || inspectorPage.isClosed() ) {
		throw new Error( 'No annotation browser is open. Call open_annotation_browser first.' );
	}

	const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000; // 30 minutes default

	const handle = await inspectorPage.waitForFunction(
		() => {
			const w = window as unknown as {
				__studioAnnotateDone?: AnnotationDoneResult;
			};
			return w.__studioAnnotateDone ?? null;
		},
		undefined,
		{ timeout: timeoutMs, polling: 500 }
	);

	const value = ( await handle.jsonValue() ) as AnnotationDoneResult | null;
	if ( ! value ) {
		throw new Error( 'Clip submission was cleared before it could be read.' );
	}

	// Close the browser once the clips are captured. This makes the
	// lifecycle unambiguous from the user's point of view — submitting
	// closes the window — and removes the failure mode where a user keeps
	// clipping after the agent has already moved on. To start another
	// round, the user just re-runs the skill, which opens a fresh browser.
	const browserToClose = inspectorBrowser;
	inspectorBrowser = null;
	inspectorPage = null;
	clips = [];
	if ( browserToClose ) {
		setTimeout( () => {
			browserToClose.close().catch( () => undefined );
		}, 2_000 );
	}

	return value;
}

export async function openAnnotationBrowser( siteUrl: string ): Promise< string > {
	// Always re-inject when the skill is invoked. A previous run may have left
	// the browser on a different page or in a broken state; replaying the
	// inject is cheap and keeps the contract simple.
	if ( inspectorBrowser && inspectorPage && ! inspectorPage.isClosed() ) {
		try {
			await inspectorPage.bringToFront();
			await injectInspector( inspectorPage );
			return 'Inspector reattached to the open browser. ⌘-click an element (or drag a region), then "Send to agent" when finished.';
		} catch {
			await shutdownBrowser();
		}
	}

	// Reuse the shared launcher so a missing/outdated Playwright Chromium is
	// auto-installed on demand, exactly like the screenshot and validation
	// tools — instead of failing with a raw "please run install" error.
	inspectorBrowser = await launchChromiumWithInstall(
		{
			headless: false,
			// 1280x800 fits comfortably on a 13" MacBook (1440x900 native) once
			// macOS chrome and the Chrome url bar are accounted for. With a larger
			// window the bottom of the page can be clipped off-screen, hiding the
			// `position: fixed` submit bar.
			args: [ '--ignore-certificate-errors', '--window-size=1280,800' ],
		},
		'the Studio annotation browser'
	);

	// `viewport: null` makes the page area follow the actual window size, so
	// `position: fixed` lands inside the visible region regardless of the
	// host screen.
	inspectorPage = await inspectorBrowser.newPage( {
		viewport: null,
		ignoreHTTPSErrors: true,
	} );

	// Host side of the console bridge: clip requests, edits, and submit.
	const page = inspectorPage;
	page.on( 'console', ( message ) => {
		const event = parseInspectorGuestEvent( message.text() );
		if ( event ) {
			void handleGuestEvent( page, event ).catch( () => undefined );
		}
	} );

	await inspectorPage.goto( siteUrl, {
		waitUntil: 'domcontentloaded',
		timeout: 30_000,
	} );
	await inspectorPage.waitForLoadState( 'networkidle', { timeout: 10_000 } ).catch( () => {} );

	await injectInspector( inspectorPage );

	// Re-inject after client-side navigations within the WordPress site so
	// the inspector doesn't disappear if the user clicks a link.
	inspectorPage.on( 'framenavigated', ( frame ) => {
		if ( frame === inspectorPage?.mainFrame() ) {
			void injectInspector( inspectorPage ).catch( () => undefined );
		}
	} );

	// macOS chromium often opens behind the terminal — make sure the user
	// actually sees the new window.
	await inspectorPage.bringToFront();

	// Closing the page (red traffic-light button) has to tear down the whole
	// chromium process or its dock icon stays around — Playwright's chromium
	// has no real app menu so the regular Cmd+Q path doesn't reach it.
	inspectorPage.on( 'close', () => {
		void shutdownBrowser();
	} );
	inspectorBrowser.on( 'disconnected', () => {
		inspectorBrowser = null;
		inspectorPage = null;
	} );

	installProcessExitHook();

	return `Annotation browser opened at ${ siteUrl }. Hold ⌘ (Ctrl on Windows/Linux) and click an element to clip it, drag for a region, right-click for more, then click "Send to agent" when finished.`;
}
