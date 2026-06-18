/**
 * Opens a headed Playwright browser on a Studio site with the Studio
 * annotation inspector injected.
 *
 * The inspector is a self-contained vanilla-DOM widget defined in
 * `./page-script.ts` — no React, no esm.sh, no external dependencies, no
 * page-CSS conflicts. The user clicks elements, types comments, and clicks
 * "Done" to send everything back to the CLI via `window.__studioAnnotateDone`.
 */

import { launchChromiumWithInstall } from 'cli/ai/browser-utils';
import { INSPECTOR_PAGE_SCRIPT } from 'cli/ai/inspector/page-script';

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

let inspectorBrowser: Browser | null = null;
let inspectorPage: Page | null = null;
let processExitHookInstalled = false;

async function shutdownBrowser(): Promise< void > {
	const browser = inspectorBrowser;
	inspectorBrowser = null;
	inspectorPage = null;
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
	}, INSPECTOR_PAGE_SCRIPT );

	await page.waitForSelector( '#__studio-inspector-host', {
		timeout: 5_000,
		state: 'attached',
	} );
}

export interface AnnotationDoneResult {
	capturedAt: number;
	url: string;
	annotations: unknown[];
}

/**
 * Block until the user clicks "Done" in the inspector toolbar, then return
 * the annotations. Reads from `window.__studioAnnotateDone` which the page
 * script populates from its in-memory state and localStorage.
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
		throw new Error( 'Annotation submission was cleared before it could be read.' );
	}

	// Auto-close the browser once we've captured the annotations. This
	// makes the lifecycle unambiguous from the user's point of view —
	// clicking "Done" closes the window — and removes the failure mode
	// where a user re-annotates after the agent has already moved on, with
	// the new payload sitting on `window.__studioAnnotateDone` but nobody
	// polling for it. To start another round, the user just re-runs the
	// skill, which opens a fresh browser.
	//
	// The short delay lets the page-side "Sent N annotation(s)" toast
	// stay visible long enough for the user to register what happened
	// before the window disappears.
	const browserToClose = inspectorBrowser;
	inspectorBrowser = null;
	inspectorPage = null;
	if ( browserToClose ) {
		setTimeout( () => {
			browserToClose.close().catch( () => undefined );
		}, 10_000 );
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
			return 'Inspector reattached to the open browser. Click "Annotate" to pick an element, then "Done" when finished.';
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
			// `position: fixed; bottom: 1.25rem` toolbar.
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

	await inspectorPage.goto( siteUrl, {
		waitUntil: 'domcontentloaded',
		timeout: 30_000,
	} );
	await inspectorPage.waitForLoadState( 'networkidle', { timeout: 10_000 } ).catch( () => {} );

	await injectInspector( inspectorPage );

	// Re-inject after client-side navigations within the WordPress site so
	// the toolbar doesn't disappear if the user clicks a link.
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

	return `Annotation browser opened at ${ siteUrl }. Click "Annotate" in the bottom-right toolbar, click an element, type your feedback, then click "Done" when you're finished.`;
}
