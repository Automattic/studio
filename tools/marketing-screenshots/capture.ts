#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
	addPanelLayoutSearchParams,
	parseEffectivePanelLayout,
	parsePreviewPanelState,
	parsePreviewWidthRatio,
	parseSidebarPanelState,
	parseSidebarWidth,
	type PanelLayoutOverrides,
} from './layout.ts';
import {
	createManifest,
	getCaptureRelativePath,
	renderContactSheet,
	type CaptureDiagnostics,
	type CaptureManifestEntry,
	type GitMetadata,
} from './manifest.ts';
import { validatePng } from './png.ts';
import {
	CAPTURE_PRESETS,
	DEFAULT_PRESET_IDS,
	DEFAULT_SCENARIO_IDS,
	SCENARIO_IDS,
	THEMES,
	resolveSelection,
	type CapturePreset,
	type PresetId,
	type ScenarioId,
	type Theme,
} from './presets.ts';
import { startStaticServer } from './static-server.ts';

const READY_SELECTOR = '[data-marketing-screenshot-ready="true"]';
const DEFAULT_TIMEOUT_MS = 30_000;
const FIXED_CLOCK_ISO = '2026-08-11T12:00:00.000Z';

interface CliOptions {
	scenarios?: string[];
	themes?: string[];
	presets?: string[];
	distDirectory: string;
	outputDirectory?: string;
	commit?: string;
	timeoutMs: number;
	headless: boolean;
	help: boolean;
	list: boolean;
	panelLayoutOverrides: PanelLayoutOverrides;
}

interface CaptureOptions {
	browser: Browser;
	origin: string;
	outputDirectory: string;
	scenario: ScenarioId;
	theme: Theme;
	preset: CapturePreset;
	timeoutMs: number;
	panelLayoutOverrides: PanelLayoutOverrides;
}

async function main(): Promise< void > {
	const cli = parseArguments( process.argv.slice( 2 ) );
	if ( cli.help ) {
		process.stdout.write( getHelpText() );
		return;
	}
	if ( cli.list ) {
		printAvailableValues();
		return;
	}

	const scenarios = resolveSelection(
		cli.scenarios,
		SCENARIO_IDS,
		DEFAULT_SCENARIO_IDS,
		'scenario'
	);
	const themes = resolveSelection( cli.themes, THEMES, THEMES, 'theme' );
	const presetIds = resolveSelection(
		cli.presets,
		Object.keys( CAPTURE_PRESETS ) as PresetId[],
		DEFAULT_PRESET_IDS,
		'preset'
	);
	const distDirectory = path.resolve( cli.distDirectory );
	const git = readGitMetadata( cli.commit );
	const outputDirectory = path.resolve(
		cli.outputDirectory ??
			path.join( 'artifacts', 'marketing-screenshots', git.commit.slice( 0, 12 ) )
	);
	const server = await startStaticServer( distDirectory );
	let browser: Browser | undefined;
	const captures: CaptureManifestEntry[] = [];

	try {
		browser = await chromium.launch( { headless: cli.headless } );
		for ( const scenario of scenarios ) {
			for ( const theme of themes ) {
				for ( const presetId of presetIds ) {
					const preset = CAPTURE_PRESETS[ presetId ];
					process.stdout.write( `Capturing ${ scenario } / ${ theme } / ${ preset.id }…\n` );
					captures.push(
						await captureScreenshot( {
							browser,
							origin: server.origin,
							outputDirectory,
							scenario,
							theme,
							preset,
							timeoutMs: cli.timeoutMs,
							panelLayoutOverrides: cli.panelLayoutOverrides,
						} )
					);
				}
			}
		}
	} finally {
		await browser?.close();
		await server.close();
	}

	const manifest = createManifest( {
		generatedAt: new Date().toISOString(),
		git,
		distDirectory: toPortablePath( path.relative( process.cwd(), distDirectory ) || '.' ),
		fixedClock: FIXED_CLOCK_ISO,
		captures,
	} );
	await mkdir( outputDirectory, { recursive: true } );
	await Promise.all( [
		writeFile(
			path.join( outputDirectory, 'manifest.json' ),
			`${ JSON.stringify( manifest, null, 2 ) }\n`
		),
		writeFile( path.join( outputDirectory, 'contact-sheet.html' ), renderContactSheet( manifest ) ),
	] );

	process.stdout.write(
		`Captured ${ captures.length } screenshot${
			captures.length === 1 ? '' : 's'
		} in ${ outputDirectory }\n`
	);
}

async function captureScreenshot( options: CaptureOptions ): Promise< CaptureManifestEntry > {
	const {
		browser,
		origin,
		outputDirectory,
		scenario,
		theme,
		preset,
		timeoutMs,
		panelLayoutOverrides,
	} = options;
	const diagnostics: CaptureDiagnostics = {
		consoleErrors: [],
		pageErrors: [],
		failedRequests: [],
		unexpectedExternalRequests: [],
	};
	const externalRequests = new Set< string >();
	const context = await browser.newContext( {
		viewport: preset.viewport,
		deviceScaleFactor: preset.deviceScaleFactor,
		colorScheme: theme,
		reducedMotion: 'reduce',
		locale: 'en-US',
		timezoneId: 'UTC',
		serviceWorkers: 'block',
	} );

	try {
		await freezeClock( context );
		await installNetworkGuard( context, origin, externalRequests );
		const page = await context.newPage();
		installDiagnostics( page, diagnostics, externalRequests );
		const scenarioUrl = new URL( '/', origin );
		scenarioUrl.searchParams.set( 'scenario', scenario );
		scenarioUrl.searchParams.set( 'theme', theme );
		addPanelLayoutSearchParams( scenarioUrl, panelLayoutOverrides );

		await page.goto( scenarioUrl.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs } );
		await disableMotion( page );
		const readyMarker = await waitForReadyMarker( page, timeoutMs );
		await waitForStableAssets( page );
		await assertUsefulDocument( page );
		await settlePaint( page );
		const effectivePanelLayout = await readEffectivePanelLayout( page );
		assertCleanDiagnostics( diagnostics );

		const relativePath = getCaptureRelativePath( scenario, theme, preset.id );
		const outputPath = path.join( outputDirectory, ...relativePath.split( '/' ) );
		await mkdir( path.dirname( outputPath ), { recursive: true } );
		await page.screenshot( {
			path: outputPath,
			type: 'png',
			fullPage: false,
			animations: 'disabled',
			caret: 'hide',
			scale: 'device',
		} );

		const png = await validatePng( outputPath, preset.output );
		assertCleanDiagnostics( diagnostics );
		return {
			scenario,
			theme,
			preset: preset.id,
			captureTier: 'renderer',
			hostProfile: 'browser',
			simulatedHost: true,
			applicationMode: 'browser',
			logicalViewport: preset.viewport,
			deviceScaleFactor: preset.deviceScaleFactor,
			outputDimensions: preset.output,
			composition: {
				crop: 'none',
				padding: 'none',
				background: 'application',
				shadow: 'none',
			},
			relativePath,
			readyMarker,
			fileSizeBytes: png.fileSizeBytes,
			panelLayout: {
				requested: { ...panelLayoutOverrides },
				effective: effectivePanelLayout,
			},
			diagnostics,
		};
	} finally {
		await context.close();
	}
}

async function freezeClock( context: BrowserContext ): Promise< void > {
	const fixedTimestamp = Date.parse( FIXED_CLOCK_ISO );
	await context.addInitScript( {
		content: `
			(() => {
				const NativeDate = globalThis.Date;
				const fixedTimestamp = ${ fixedTimestamp };
				function FrozenDate(...args) {
					if (!new.target) {
						return new NativeDate(fixedTimestamp).toString();
					}
					return Reflect.construct(
						NativeDate,
						args.length === 0 ? [ fixedTimestamp ] : args,
						new.target
					);
				}
				Object.setPrototypeOf(FrozenDate, NativeDate);
				FrozenDate.prototype = NativeDate.prototype;
				FrozenDate.now = () => fixedTimestamp;
				FrozenDate.parse = NativeDate.parse;
				FrozenDate.UTC = NativeDate.UTC;
				globalThis.Date = FrozenDate;
			})();
		`,
	} );
}

async function installNetworkGuard(
	context: BrowserContext,
	origin: string,
	externalRequests: Set< string >
): Promise< void > {
	await context.route( '**/*', async ( route ) => {
		const requestUrl = route.request().url();
		const parsedUrl = new URL( requestUrl );
		if ( [ 'http:', 'https:' ].includes( parsedUrl.protocol ) && parsedUrl.origin !== origin ) {
			externalRequests.add( requestUrl );
			await route.abort( 'blockedbyclient' );
			return;
		}
		await route.continue();
	} );
}

function installDiagnostics(
	page: Page,
	diagnostics: CaptureDiagnostics,
	externalRequests: Set< string >
): void {
	page.on( 'console', ( message ) => {
		if ( message.type() === 'error' ) {
			diagnostics.consoleErrors.push( message.text() );
		}
	} );
	page.on( 'pageerror', ( error ) => {
		diagnostics.pageErrors.push( error.message );
	} );
	page.on( 'requestfailed', ( request ) => {
		if ( ! externalRequests.has( request.url() ) ) {
			diagnostics.failedRequests.push(
				`${ request.method() } ${ request.url() }: ${
					request.failure()?.errorText ?? 'unknown failure'
				}`
			);
		}
	} );
	page.on( 'response', ( response ) => {
		if ( response.status() >= 400 ) {
			diagnostics.failedRequests.push( `${ response.status() } ${ response.url() }` );
		}
	} );
	page.on( 'requestfailed', ( request ) => {
		if ( externalRequests.has( request.url() ) ) {
			diagnostics.unexpectedExternalRequests.push( request.url() );
		}
	} );
}

async function disableMotion( page: Page ): Promise< void > {
	await page.addStyleTag( {
		content: `
			*, *::before, *::after {
				animation-delay: 0s !important;
				animation-duration: 0s !important;
				caret-color: transparent !important;
				transition-delay: 0s !important;
				transition-duration: 0s !important;
			}
		`,
	} );
}

async function waitForReadyMarker( page: Page, timeoutMs: number ): Promise< string > {
	const marker = await page.waitForFunction(
		( selector ) => {
			if ( document.querySelector( selector ) ) {
				return 'data-marketing-screenshot-ready';
			}
			const screenshotWindow = window as typeof window & {
				__STUDIO_MARKETING_SCREENSHOT_READY__?: boolean;
			};
			return screenshotWindow.__STUDIO_MARKETING_SCREENSHOT_READY__
				? 'window.__STUDIO_MARKETING_SCREENSHOT_READY__'
				: false;
		},
		READY_SELECTOR,
		{ timeout: timeoutMs }
	);

	return ( await marker.jsonValue() ) as string;
}

async function waitForStableAssets( page: Page ): Promise< void > {
	await page.evaluate( async () => {
		await document.fonts.ready;
		await Promise.all(
			Array.from( document.images, ( image ) => {
				if ( image.complete ) {
					return undefined;
				}
				return new Promise< void >( ( resolve ) => {
					image.addEventListener( 'load', () => resolve(), { once: true } );
					image.addEventListener( 'error', () => resolve(), { once: true } );
				} );
			} )
		);
	} );

	const brokenImages = await page
		.locator( 'img' )
		.evaluateAll( ( images ) =>
			images
				.filter(
					( image ) =>
						! ( image as HTMLImageElement ).complete || ! ( image as HTMLImageElement ).naturalWidth
				)
				.map(
					( image ) => ( image as HTMLImageElement ).currentSrc || ( image as HTMLImageElement ).src
				)
		);
	if ( brokenImages.length ) {
		throw new Error( `Scenario contains unloaded images: ${ brokenImages.join( ', ' ) }` );
	}
}

async function assertUsefulDocument( page: Page ): Promise< void > {
	const documentState = await page.evaluate( () => ( {
		textLength: document.body.innerText.trim().length,
		width: document.documentElement.clientWidth,
		height: document.documentElement.clientHeight,
	} ) );
	if ( documentState.textLength < 2 ) {
		throw new Error( 'Scenario rendered no visible text and may be blank.' );
	}
	if ( documentState.width < 1 || documentState.height < 1 ) {
		throw new Error( 'Scenario document has invalid layout dimensions.' );
	}
}

async function readEffectivePanelLayout( page: Page ) {
	const value: unknown = await page.evaluate( () => {
		const screenshotWindow = window as typeof window & {
			__STUDIO_MARKETING_PANEL_LAYOUT__?: unknown;
		};
		return screenshotWindow.__STUDIO_MARKETING_PANEL_LAYOUT__;
	} );

	return parseEffectivePanelLayout( value );
}

async function settlePaint( page: Page ): Promise< void > {
	await page.evaluate(
		() =>
			new Promise< void >( ( resolve ) => {
				requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) );
			} )
	);
}

function assertCleanDiagnostics( diagnostics: CaptureDiagnostics ): void {
	const sections = [
		[ 'Console errors', diagnostics.consoleErrors ],
		[ 'Page errors', diagnostics.pageErrors ],
		[ 'Failed requests', diagnostics.failedRequests ],
		[ 'Unexpected external requests', diagnostics.unexpectedExternalRequests ],
	] as const;
	const failures = sections.filter( ( [ , values ] ) => values.length );
	if ( failures.length ) {
		throw new Error(
			failures
				.map(
					( [ label, values ] ) =>
						`${ label }:\n${ values.map( ( value ) => `  - ${ value }` ).join( '\n' ) }`
				)
				.join( '\n' )
		);
	}
}

function parseArguments( arguments_: string[] ): CliOptions {
	const options: CliOptions = {
		distDirectory: 'apps/ui/dist-marketing',
		timeoutMs: DEFAULT_TIMEOUT_MS,
		headless: true,
		help: false,
		list: false,
		panelLayoutOverrides: {},
	};

	for ( let index = 0; index < arguments_.length; index++ ) {
		const argument = arguments_[ index ];
		const [ flag, inlineValue ] = argument.split( '=', 2 );
		const readValue = (): string => {
			if ( inlineValue !== undefined ) {
				return inlineValue;
			}
			const value = arguments_[ ++index ];
			if ( ! value || value.startsWith( '--' ) ) {
				throw new Error( `${ flag } requires a value.` );
			}
			return value;
		};

		switch ( flag ) {
			case '--scenario':
				( options.scenarios ??= [] ).push( readValue() );
				break;
			case '--theme':
				( options.themes ??= [] ).push( readValue() );
				break;
			case '--preset':
				( options.presets ??= [] ).push( readValue() );
				break;
			case '--dist':
				options.distDirectory = readValue();
				break;
			case '--output':
				options.outputDirectory = readValue();
				break;
			case '--commit':
				options.commit = readValue();
				break;
			case '--preview-width-ratio':
				options.panelLayoutOverrides.previewWidthRatio = parsePreviewWidthRatio( readValue() );
				break;
			case '--sidebar-width':
				options.panelLayoutOverrides.sidebarWidth = parseSidebarWidth( readValue() );
				break;
			case '--preview':
				options.panelLayoutOverrides.preview = parsePreviewPanelState( readValue() );
				break;
			case '--sidebar':
				options.panelLayoutOverrides.sidebar = parseSidebarPanelState( readValue() );
				break;
			case '--timeout': {
				const timeout = Number( readValue() );
				if ( ! Number.isInteger( timeout ) || timeout < 1 ) {
					throw new Error( '--timeout must be a positive integer in milliseconds.' );
				}
				options.timeoutMs = timeout;
				break;
			}
			case '--headful':
				options.headless = false;
				break;
			case '--list':
				options.list = true;
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				throw new Error( `Unknown argument: ${ argument }` );
		}
	}

	return options;
}

function readGitMetadata( commitOverride?: string ): GitMetadata {
	const runGit = ( arguments_: string[] ): string =>
		execFileSync( 'git', arguments_, { encoding: 'utf8' } ).trim();

	try {
		return {
			commit: commitOverride ?? runGit( [ 'rev-parse', 'HEAD' ] ),
			dirty: runGit( [ 'status', '--porcelain' ] ).length > 0,
		};
	} catch {
		return {
			commit: commitOverride ?? 'unknown',
			dirty: true,
		};
	}
}

function printAvailableValues(): void {
	process.stdout.write( `Scenarios:\n  ${ SCENARIO_IDS.join( '\n  ' ) }\n` );
	process.stdout.write( `Themes:\n  ${ THEMES.join( '\n  ' ) }\n` );
	process.stdout.write( 'Presets:\n' );
	for ( const preset of Object.values( CAPTURE_PRESETS ) ) {
		process.stdout.write(
			`  ${ preset.id }: ${ preset.output.width }x${ preset.output.height } — ${ preset.description }\n`
		);
	}
}

function getHelpText(): string {
	return `Capture deterministic Studio Agentic UI marketing screenshots.

Usage:
  npm run screenshots:marketing -- [options]

Options:
  --scenario <id[,id]|all>  Scenario filter; repeatable (default: add-site,site-overview)
  --theme <light|dark|all>   Theme filter; repeatable (default: all)
  --preset <id[,id]|all>    Output preset filter; repeatable (default: smoke)
  --dist <path>              Static marketing build (default: apps/ui/dist-marketing)
  --output <path>            Exact run output directory
  --commit <sha>             Override commit recorded in the manifest
  --preview-width-ratio <n>  Preview share of content area, from 0.2 through 0.8
  --sidebar-width <px>       Expanded sidebar width, from 240 through 600 logical px
  --preview <state>          Override preview state: open or closed
  --sidebar <state>          Override sidebar state: expanded or collapsed
  --timeout <ms>             Scenario-ready timeout (default: ${ DEFAULT_TIMEOUT_MS })
  --headful                  Show Chromium while capturing
  --list                     List scenarios, themes, and presets
  --help                     Show this help
`;
}

function toPortablePath( value: string ): string {
	return value.split( path.sep ).join( '/' );
}

void main().catch( ( error: unknown ) => {
	const message = error instanceof Error ? error.message : String( error );
	process.stderr.write( `Marketing screenshot capture failed: ${ message }\n` );
	process.exitCode = 1;
} );
