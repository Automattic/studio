#!/usr/bin/env node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { writeNativeReviewArtifacts, type NativeCaptureEntry } from './native-artifacts.ts';
import { validatePng } from './png.ts';
import { CAPTURE_PRESETS, type CapturePreset, type Theme } from './presets.ts';
import { createRealWordPressSite, type RealWordPressSite } from './real-site.ts';
import { startStaticServer, type StaticServer } from './static-server.ts';

const READY_SELECTOR = '[data-marketing-screenshot-ready="true"]';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_DIRECTORY = path.join(
	'artifacts',
	'marketing-screenshots',
	'native-annotation-test'
);
const ANNOTATION_COMMENT = 'Make the headline warmer and more specific to the autumn collection.';

interface CliOptions {
	distDirectory: string;
	outputDirectory: string;
	siteUrl?: string;
	theme: Theme;
	preset: CapturePreset;
	timeoutMs: number;
}

async function main(): Promise< void > {
	const options = parseArguments( process.argv.slice( 2 ) );
	let server: StaticServer | undefined;
	let realSite: RealWordPressSite | undefined;
	let captureUserData: string | undefined;
	let electronApp: ElectronApplication | undefined;
	const captures: NativeCaptureEntry[] = [];

	try {
		if ( ! options.siteUrl ) {
			process.stdout.write( 'Provisioning an isolated real WordPress site…\n' );
			realSite = await createRealWordPressSite();
		}
		const previewOrigin = options.siteUrl ?? realSite?.origin;
		if ( ! previewOrigin ) {
			throw new Error( 'A real WordPress preview origin is required.' );
		}

		server = await startStaticServer( options.distDirectory );
		captureUserData = await mkdtemp( path.join( os.tmpdir(), 'studio-marketing-electron-' ) );
		const captureUrl = createCaptureUrl( server.origin, previewOrigin, options );
		const require = createRequire( import.meta.url );
		const electronPath = require( 'electron' ) as string;
		const electronMainPath = path.resolve( 'tools/marketing-screenshots/electron-main.cjs' );

		electronApp = await _electron.launch( {
			executablePath: electronPath,
			args: [ electronMainPath ],
			env: {
				...process.env,
				STUDIO_MARKETING_CAPTURE_URL: captureUrl.href,
				STUDIO_MARKETING_CAPTURE_WIDTH: String( options.preset.viewport.width ),
				STUDIO_MARKETING_CAPTURE_HEIGHT: String( options.preset.viewport.height ),
				STUDIO_MARKETING_CAPTURE_SCALE: String( options.preset.deviceScaleFactor ),
				STUDIO_MARKETING_CAPTURE_THEME: options.theme,
				STUDIO_MARKETING_CAPTURE_USER_DATA: captureUserData,
			},
			timeout: options.timeoutMs,
		} );
		const page = await electronApp.firstWindow( { timeout: options.timeoutMs } );
		await page.locator( READY_SELECTOR ).waitFor( { timeout: options.timeoutMs } );
		await assertDemoPortfolio( page );
		await page.getByRole( 'button', { name: 'Annotate' } ).waitFor( {
			state: 'visible',
			timeout: options.timeoutMs,
		} );
		await waitForGuestPage( electronApp, previewOrigin, '/', options.timeoutMs );
		await assertPreviewGeometry( page, electronApp );
		await assertPreviewContentFits( electronApp, 'site preview' );
		captures.push(
			await captureCompositedWindow( page, electronApp, options, 'annotation-ready' )
		);

		await page.getByRole( 'button', { name: 'Annotate' } ).click();
		await page.getByRole( 'button', { name: 'Stop annotating' } ).waitFor( {
			state: 'visible',
			timeout: options.timeoutMs,
		} );
		captures.push(
			await captureCompositedWindow( page, electronApp, options, 'annotation-picking' )
		);

		await openAnnotationDraft( electronApp );
		captures.push(
			await captureCompositedWindow( page, electronApp, options, 'annotation-draft' )
		);

		await saveAnnotation( electronApp );
		await page.getByRole( 'button', { name: 'Submit annotations' } ).waitFor( {
			state: 'visible',
			timeout: options.timeoutMs,
		} );
		captures.push(
			await captureCompositedWindow( page, electronApp, options, 'annotation-saved' )
		);

		await page.getByRole( 'button', { name: 'Submit annotations' } ).click();
		await page.getByText( '1 annotation submitted', { exact: true } ).waitFor( {
			state: 'visible',
			timeout: options.timeoutMs,
		} );
		captures.push(
			await captureCompositedWindow( page, electronApp, options, 'annotation-submitted' )
		);

		await page.getByRole( 'button', { name: 'View WP Admin' } ).click();
		await waitForGuestPage( electronApp, previewOrigin, '/wp-admin/', options.timeoutMs );
		await assertPreviewGeometry( page, electronApp );
		await assertRealApplication( electronApp, 'wordpress' );
		await assertPreviewContentFits( electronApp, 'WordPress tab' );
		captures.push( await captureCompositedWindow( page, electronApp, options, 'wordpress-tab' ) );

		await page.getByRole( 'button', { name: 'View database' } ).click();
		await waitForGuestPage( electronApp, previewOrigin, '/phpmyadmin/', options.timeoutMs );
		await assertPreviewGeometry( page, electronApp );
		await assertRealApplication( electronApp, 'phpmyadmin' );
		captures.push( await captureCompositedWindow( page, electronApp, options, 'database-tab' ) );
		await writeNativeReviewArtifacts( {
			outputDirectory: options.outputDirectory,
			theme: options.theme,
			preset: options.preset,
			captures,
		} );
	} finally {
		await electronApp?.close();
		await server?.close();
		if ( captureUserData ) {
			await rm( captureUserData, { recursive: true, force: true } );
		}
		await realSite?.close();
	}

	process.stdout.write( `Captured isolated native previews in ${ options.outputDirectory }\n` );
}

function createCaptureUrl( appOrigin: string, previewOrigin: string, options: CliOptions ): URL {
	const url = new URL( '/', appOrigin );
	url.searchParams.set( 'scenario', 'agent-complete-preview' );
	url.searchParams.set( 'theme', options.theme );
	url.searchParams.set( 'sidebar', 'expanded' );
	url.searchParams.set( 'sidebarWidth', '280' );
	url.searchParams.set( 'preview', 'open' );
	url.searchParams.set( 'previewWidthRatio', '0.68' );
	url.searchParams.set( 'previewOrigin', previewOrigin );
	url.searchParams.set( 'annotatePreview', 'true' );
	return url;
}

async function assertPreviewGeometry(
	page: Page,
	electronApp: ElectronApplication
): Promise< void > {
	const host = await page.locator( 'webview' ).evaluate( ( element ) => {
		const bounds = element.getBoundingClientRect();
		return {
			width: bounds.width,
			height: bounds.height,
		};
	} );
	const guest = await executeInPreview(
		electronApp,
		`( () => {
			const headline = document.querySelector( 'main h1, .hero h1' );
			const headlineBounds = headline && headline.getBoundingClientRect();
			return {
				width: window.innerWidth,
				height: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio,
				matchesNarrowLayout: window.matchMedia( '(max-width: 900px)' ).matches,
				documentWidth: document.documentElement.scrollWidth,
				headlineRight: headlineBounds && headlineBounds.right,
			};
		} )()`
	);
	if ( ! guest || typeof guest !== 'object' ) {
		throw new Error( 'Could not read the preview webview geometry.' );
	}
	const geometry = guest as {
		width?: unknown;
		height?: unknown;
		devicePixelRatio?: unknown;
		matchesNarrowLayout?: unknown;
		documentWidth?: unknown;
		headlineRight?: unknown;
	};
	const appViewport = await page.evaluate( () => ( {
		width: window.innerWidth,
		height: window.innerHeight,
		devicePixelRatio: window.devicePixelRatio,
	} ) );
	process.stdout.write(
		`App viewport ${ appViewport.width }x${ appViewport.height } at ${ appViewport.devicePixelRatio }x; ` +
			`preview pane ${ host.width }x${ host.height }; guest ${ String( geometry.width ) }x${ String(
				geometry.height
			) } at ${ String( geometry.devicePixelRatio ) }x; narrow=${ String(
				geometry.matchesNarrowLayout
			) }, document=${ String( geometry.documentWidth ) }, headlineRight=${ String(
				geometry.headlineRight
			) }.\n`
	);
	if (
		typeof geometry.width !== 'number' ||
		typeof geometry.height !== 'number' ||
		Math.abs( geometry.width - host.width ) > 1 ||
		Math.abs( geometry.height - host.height ) > 1
	) {
		throw new Error(
			`Default Fit-pane preview guest is ${ String( geometry.width ) }x${ String(
				geometry.height
			) } inside a ${ host.width }x${ host.height } panel.`
		);
	}
	if (
		typeof geometry.documentWidth !== 'number' ||
		geometry.documentWidth > ( geometry.width as number ) + 1
	) {
		throw new Error(
			`Preview document is ${ String( geometry.documentWidth ) } CSS pixels wide inside a ${ String(
				geometry.width
			) }px guest viewport.`
		);
	}
}

async function assertPreviewContentFits(
	electronApp: ElectronApplication,
	label: string
): Promise< void > {
	const result = await executeInPreview(
		electronApp,
		`( () => {
			const selectors = [
				'header',
				'main',
				'.hero',
				'.hero-copy',
				'.hero h1',
				'.shell',
				'.content',
				'.welcome',
				'.tabs',
				'table',
			];
			const viewportWidth = window.innerWidth;
			const elements = selectors.flatMap( ( selector ) =>
				Array.from( document.querySelectorAll( selector ) ).map( ( element ) => {
					const bounds = element.getBoundingClientRect();
					return {
						selector,
						left: bounds.left,
						right: bounds.right,
						width: bounds.width,
					};
				} )
			);
			return {
				viewportWidth,
				documentWidth: document.documentElement.scrollWidth,
				overflowing: elements.filter(
					( element ) => element.width > 0 && ( element.left < -1 || element.right > viewportWidth + 1 )
				),
			};
		} )()`
	);
	if ( ! result || typeof result !== 'object' ) {
		throw new Error( `Could not validate ${ label } content bounds.` );
	}
	const fit = result as {
		viewportWidth?: unknown;
		documentWidth?: unknown;
		overflowing?: unknown;
	};
	if (
		typeof fit.viewportWidth !== 'number' ||
		typeof fit.documentWidth !== 'number' ||
		! Array.isArray( fit.overflowing )
	) {
		throw new Error( `Could not validate ${ label } content bounds.` );
	}
	if ( fit.documentWidth > fit.viewportWidth + 1 || fit.overflowing.length > 0 ) {
		throw new Error(
			`${ label } does not fit its ${ fit.viewportWidth }px preview viewport: ` +
				JSON.stringify( {
					documentWidth: fit.documentWidth,
					overflowing: fit.overflowing,
				} )
		);
	}
	process.stdout.write(
		`${ label } content fits its ${ fit.viewportWidth }px preview viewport without horizontal overflow.\n`
	);
}

async function assertRealApplication(
	electronApp: ElectronApplication,
	application: 'wordpress' | 'phpmyadmin'
): Promise< void > {
	const result = await executeInPreview(
		electronApp,
		application === 'wordpress'
			? `( {
				title: document.title,
				isWordPressAdmin: document.body.classList.contains( 'wp-admin' ),
				hasAdminMenu: Boolean( document.getElementById( 'adminmenu' ) ),
			} )`
			: `( {
				title: document.title,
				hasNavigation: Boolean( document.getElementById( 'pma_navigation' ) ),
				hasPhpMyAdmin: /phpMyAdmin/i.test( document.title ),
			} )`
	);
	const state = result as Record< string, unknown > | null;
	const valid =
		application === 'wordpress'
			? state?.isWordPressAdmin === true && state.hasAdminMenu === true
			: state?.hasNavigation === true && state.hasPhpMyAdmin === true;
	if ( ! valid ) {
		throw new Error(
			`The ${ application } capture is not the real application: ${ JSON.stringify( state ) }`
		);
	}
}

async function assertDemoPortfolio( page: Page ): Promise< void > {
	const expectedSites = [
		'Meridian Coffee',
		'Juniper Journal',
		'Atlas Creative',
		'Lantern Books',
		'Northstar Yoga',
		'Harbor & Pine',
		'Fieldwork Studio',
		'Common Table',
	];
	for ( const siteName of expectedSites ) {
		if ( ( await page.getByText( siteName, { exact: true } ).count() ) === 0 ) {
			throw new Error(
				`Native capture is not using the standardized demo portfolio; missing ${ siteName }.`
			);
		}
	}
}

async function captureCompositedWindow(
	page: Page,
	electronApp: ElectronApplication,
	options: CliOptions,
	name: string
): Promise< NativeCaptureEntry > {
	const relativePath = `${ name }.png`;
	const outputPath = path.join( options.outputDirectory, relativePath );
	await mkdir( path.dirname( outputPath ), { recursive: true } );
	await page.evaluate(
		() => new Promise< void >( ( resolve ) => requestAnimationFrame( () => resolve() ) )
	);
	// A Playwright page screenshot only captures the host renderer and can mis-scale Electron's
	// separately composited <webview>. capturePage() records the same fully composed window pixels
	// that are visible on screen.
	const pngBase64 = await electronApp.evaluate( async ( { BrowserWindow } ) => {
		const captureWindow = BrowserWindow.getAllWindows()[ 0 ];
		if ( ! captureWindow ) throw new Error( 'Capture window is unavailable.' );
		const image = await captureWindow.webContents.capturePage();
		return image.toPNG().toString( 'base64' );
	} );
	await writeFile( outputPath, Buffer.from( pngBase64, 'base64' ) );
	await validatePng( outputPath, options.preset.output );
	return { name, relativePath };
}

async function waitForGuestPage(
	electronApp: ElectronApplication,
	expectedOrigin: string,
	pathnamePrefix: string,
	timeoutMs: number
): Promise< void > {
	const deadline = Date.now() + timeoutMs;
	while ( Date.now() < deadline ) {
		const guest = await electronApp.evaluate( ( { webContents } ) => {
			const preview = webContents
				.getAllWebContents()
				.find( ( contents ) => contents.getType() === 'webview' );
			return preview ? { url: preview.getURL(), loading: preview.isLoading() } : null;
		} );
		if ( guest && ! guest.loading ) {
			const guestUrl = new URL( guest.url );
			if ( guestUrl.origin === expectedOrigin && guestUrl.pathname.startsWith( pathnamePrefix ) ) {
				return;
			}
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
	}
	throw new Error( `Timed out waiting for the preview webview path ${ pathnamePrefix }.` );
}

async function openAnnotationDraft( electronApp: ElectronApplication ): Promise< void > {
	await executeInPreview(
		electronApp,
		`( () => {
		const target = document.querySelector( 'main h1' ) || document.querySelector( 'h1' ) || document.querySelector( '.wp-block-site-title' );
		if ( ! target ) throw new Error( 'The real WordPress page has no annotatable heading.' );
		const bounds = target.getBoundingClientRect();
		const clientX = bounds.left + Math.min( bounds.width / 2, 180 );
		const clientY = bounds.top + Math.min( bounds.height / 2, 40 );
		target.dispatchEvent( new MouseEvent( 'mousemove', { bubbles: true, clientX, clientY } ) );
		target.dispatchEvent( new MouseEvent( 'click', { bubbles: true, clientX, clientY } ) );
		const host = document.getElementById( '__studio-inspector-host' );
		const textarea = host && host.shadowRoot && host.shadowRoot.querySelector( 'textarea' );
		if ( ! textarea ) throw new Error( 'Annotation editor did not open.' );
		textarea.value = ${ JSON.stringify( ANNOTATION_COMMENT ) };
		textarea.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	} )()`
	);
}

async function saveAnnotation( electronApp: ElectronApplication ): Promise< void > {
	await executeInPreview(
		electronApp,
		`( () => {
		const host = document.getElementById( '__studio-inspector-host' );
		const button = host && host.shadowRoot && host.shadowRoot.querySelector( 'button.save' );
		if ( ! button || button.disabled ) throw new Error( 'Annotation cannot be saved.' );
		button.click();
	} )()`
	);
}

async function executeInPreview(
	electronApp: ElectronApplication,
	script: string
): Promise< unknown > {
	return electronApp.evaluate( async ( { webContents }, source ) => {
		const preview = webContents
			.getAllWebContents()
			.find( ( contents ) => contents.getType() === 'webview' );
		if ( ! preview ) throw new Error( 'Preview webview is unavailable.' );
		return preview.executeJavaScript( source, true );
	}, script );
}

function parseArguments( args: string[] ): CliOptions {
	let distDirectory = path.resolve( 'apps/ui/dist-marketing' );
	let outputDirectory = path.resolve( DEFAULT_OUTPUT_DIRECTORY );
	let siteUrl: string | undefined;
	let theme: Theme = 'light';
	let preset = CAPTURE_PRESETS[ 'raw-wide-2x' ];
	let timeoutMs = DEFAULT_TIMEOUT_MS;

	for ( let index = 0; index < args.length; index += 1 ) {
		const argument = args[ index ];
		const value = args[ index + 1 ];
		if ( argument === '--dist' && value ) {
			distDirectory = path.resolve( value );
			index += 1;
		} else if ( argument === '--output' && value ) {
			outputDirectory = path.resolve( value );
			index += 1;
		} else if ( argument === '--site-url' && value ) {
			const parsed = new URL( value );
			if ( parsed.protocol !== 'http:' || parsed.hostname !== 'localhost' ) {
				throw new Error( '--site-url must be an HTTP localhost URL.' );
			}
			siteUrl = parsed.origin;
			index += 1;
		} else if ( argument === '--theme' && ( value === 'light' || value === 'dark' ) ) {
			theme = value;
			index += 1;
		} else if ( argument === '--preset' && value && value in CAPTURE_PRESETS ) {
			preset = CAPTURE_PRESETS[ value as keyof typeof CAPTURE_PRESETS ];
			index += 1;
		} else if ( argument === '--timeout' && value ) {
			timeoutMs = Number.parseInt( value, 10 );
			index += 1;
		} else {
			throw new Error( `Unknown or invalid argument: ${ argument }` );
		}
	}

	return { distDirectory, outputDirectory, siteUrl, theme, preset, timeoutMs };
}

void main();
