import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { vi } from 'vitest';
import { validateBlocks } from 'cli/ai/block-validator';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { setChatArtifactCallback } from 'cli/ai/chat-artifacts';
import { emitEvent } from 'cli/ai/json-events';
import { setLocalSiteSelectedCallback } from 'cli/ai/site-selection';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { getProgressCallback, setProgressCallback } from 'cli/logger';
import {
	captureCommandOutput,
	resolveStudioToolDefinitions,
	studioToolDefinitions,
	withChatArtifactEmission,
} from '../tools';
import { createSiteTool } from '../tools/create-site';
import { enrichPreviewListOutput } from '../tools/list-previews';
import type { AnyStudioAgentTool } from '../tools/define-tool';

vi.mock( 'cli/ai/block-validator', () => ( {
	validateBlocks: vi.fn(),
} ) );

vi.mock( 'cli/ai/browser-utils', () => ( {
	getSharedBrowser: vi.fn(),
} ) );

vi.mock( 'cli/ai/json-events', () => ( {
	emitEvent: vi.fn(),
} ) );

vi.mock( 'cli/commands/preview/create', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( import( 'cli/commands/preview/delete' ), async ( importActual ) => {
	const actual = await importActual();
	return {
		Mode: actual.Mode,
		runCommand: vi.fn(),
	};
} );

vi.mock( 'cli/commands/preview/list', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/commands/preview/update', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/commands/site/create', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/commands/site/delete', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/commands/site/list', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/commands/site/start', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/commands/site/status', () => ( {
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/commands/site/stop', () => ( {
	Mode: { STOP_SINGLE_SITE: 'stop_single_site' },
	runCommand: vi.fn(),
} ) );

vi.mock( 'cli/lib/cli-config/core', async () => ( {
	...( await vi.importActual( 'cli/lib/cli-config/core' ) ),
	readCliConfig: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async () => ( {
	...( await vi.importActual( 'cli/lib/cli-config/sites' ) ),
	getSiteByFolder: vi.fn(),
} ) );

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );

vi.mock( 'cli/lib/run-wp-cli-command', () => ( {
	runWpCliCommandWithMessaging: vi.fn(),
} ) );

vi.mock( 'cli/lib/wordpress-server-manager', () => ( {
	isServerRunning: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/connected-sites', () => ( {
	getConnectedWpcomSitesForLocalSite: vi.fn(),
} ) );

describe( 'Studio AI MCP tools', () => {
	const previousScratchpadWidgetType = 'sd-' + 'artefact';
	const mockSite = {
		id: 'site-123',
		name: 'My Site',
		path: '/sites/my-site',
		adminPassword: 'password',
		port: 8888,
		phpVersion: '8.4',
	};

	const getTool = ( name: string ) => {
		const tool = studioToolDefinitions.find( ( definition ) => definition.name === name );
		expect( tool ).toBeDefined();
		return tool as ( typeof studioToolDefinitions )[ number ];
	};

	const getTextContent = ( result: { content?: Array< { type: string; text?: string } > } ) => {
		const firstContent = result.content?.[ 0 ];
		return firstContent && 'text' in firstContent ? firstContent.text : undefined;
	};
	const executeTool = (
		tool: ReturnType< typeof resolveStudioToolDefinitions >[ number ],
		args: Record< string, unknown >
	) => tool.execute( 'tool-call-1', args as never, new AbortController().signal, () => {} );
	const createMockPage = ( {
		buffer,
		documentHeight,
	}: {
		buffer: Buffer;
		documentHeight?: number;
	} ) => ( {
		emulateMedia: vi.fn(),
		goto: vi.fn(),
		waitForLoadState: vi.fn().mockResolvedValue( undefined ),
		evaluate: vi.fn().mockResolvedValue( documentHeight ),
		addStyleTag: vi.fn(),
		screenshot: vi.fn().mockResolvedValue( buffer ),
		close: vi.fn(),
	} );
	const mockScreenshotBrowser = ( ...pages: Array< ReturnType< typeof createMockPage > > ) => {
		const newPage = vi.fn();
		for ( const page of pages ) {
			newPage.mockResolvedValueOnce( page );
		}
		vi.mocked( getSharedBrowser ).mockResolvedValue( { newPage } as never );
		return { newPage };
	};
	type ScreenshotArtifact = {
		widgetProps: { alt: string; source: { path: string; name: string } };
	};
	const getScreenshotArtifacts = ( result: {
		studioArtifacts?: Array< { widgetProps: Record< string, unknown > } >;
	} ): ScreenshotArtifact[] => {
		expect( result.studioArtifacts?.length ).toBeGreaterThan( 0 );
		return result.studioArtifacts as unknown as ScreenshotArtifact[];
	};
	const cleanUpScreenshotArtifacts = ( artifacts: ScreenshotArtifact[] ) =>
		Promise.all(
			artifacts.map( ( artifact ) =>
				rm( path.dirname( artifact.widgetProps.source.path ), { recursive: true, force: true } )
			)
		);
	const mockWpCliResponse = ( {
		stdout = '',
		stderr = '',
		exitCode = 0,
	}: { stdout?: string; stderr?: string; exitCode?: number } = {} ) => ( {
		response: {
			exitCode: Promise.resolve( exitCode ),
			stdoutText: Promise.resolve( stdout ),
			stderrText: Promise.resolve( stderr ),
		},
		[ Symbol.dispose ]() {},
	} );
	const mockValidatedFix = ( fixedContent: string, blockName = 'core/paragraph' ) => {
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 0,
			invalidBlocks: 1,
			results: [
				{
					blockName,
					isValid: false,
					issues: [],
					originalContent: '',
				},
			],
			proposedFix: {
				fixedContent,
				report: {
					totalBlocks: 1,
					validBlocks: 1,
					invalidBlocks: 0,
					results: [
						{
							blockName,
							isValid: true,
							issues: [],
							originalContent: '',
						},
					],
				},
			},
		} );
	};

	beforeEach( () => {
		vi.resetAllMocks();
		process.exitCode = undefined;
		setProgressCallback( null );
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ mockSite ],
		} as Awaited< ReturnType< typeof readCliConfig > > );
		vi.mocked( getSiteByFolder ).mockResolvedValue( mockSite );
	} );

	afterEach( () => {
		setProgressCallback( null );
		setLocalSiteSelectedCallback( null );
	} );

	it( 'includes preview tools in the MCP registry', () => {
		expect( studioToolDefinitions.map( ( tool ) => tool.name ) ).toEqual(
			expect.arrayContaining( [
				'preview_create',
				'preview_list',
				'preview_update',
				'preview_delete',
			] )
		);
	} );

	it( 'reports invalid core/html blocks and skips editor validation', async () => {
		const result = await getTool( 'validate_blocks' ).rawHandler( {
			nameOrPath: 'My Site',
			content:
				'<!-- wp:html --><form><label>Email<input type="email" /></label></form><!-- /wp:html -->',
		} as never );

		const text = getTextContent( result );
		expect( text ).toContain( 'HTML block policy: 1/1 core/html blocks invalid' );
		expect( text ).toContain( '<form>' );
		// The HTML policy gate short-circuits before the live editor runs.
		expect( validateBlocks ).not.toHaveBeenCalled();
	} );

	it( 'returns fixed inline block content', async () => {
		const originalContent =
			'<!-- wp:paragraph {"align":"center"} --><p>Hello</p><!-- /wp:paragraph -->';
		const fixedContent =
			'<!-- wp:paragraph {"align":"center"} -->\n<p class="has-text-align-center">Hello</p>\n<!-- /wp:paragraph -->';
		mockValidatedFix( fixedContent );

		const result = await getTool( 'validate_blocks' ).rawHandler( {
			nameOrPath: 'My Site',
			content: originalContent,
		} as never );

		expect( validateBlocks ).toHaveBeenCalledWith(
			originalContent,
			expect.stringContaining( 'localhost:8888' )
		);
		const text = getTextContent( result );
		expect( text ).toContain( 'Fixed block content:' );
		expect( text ).toContain( fixedContent );
	} );

	it( 'applies valid editor serialization fixes to files', async () => {
		const tempDir = await mkdtemp( path.join( os.tmpdir(), 'studio-block-fix-' ) );
		const filePath = path.join( tempDir, 'page.html' );
		const originalContent =
			'<!-- wp:separator {"className":"section-rule"} --><hr class="wp-block-separator section-rule"/><!-- /wp:separator -->';
		const fixedContent =
			'<!-- wp:separator {"opacity":"css","className":"section-rule"} -->\n<hr class="wp-block-separator has-css-opacity section-rule"/>\n<!-- /wp:separator -->';
		await writeFile( filePath, originalContent );
		mockValidatedFix( fixedContent, 'core/separator' );

		try {
			const result = await getTool( 'validate_blocks' ).rawHandler( {
				nameOrPath: 'My Site',
				filePath,
			} as never );

			await expect( readFile( filePath, 'utf8' ) ).resolves.toBe( fixedContent );
			const text = getTextContent( result );
			expect( text ).toContain( 'Auto-fix applied: 1/1 blocks valid' );
			expect( text ).not.toContain( 'Fixed block content:' );
		} finally {
			await rm( tempDir, { recursive: true, force: true } );
		}
	} );

	it( 'exposes the explicit presentation tool when chat artifacts are enabled', () => {
		const names = resolveStudioToolDefinitions().map( ( tool ) => tool.name );
		expect( names ).not.toContain( 'show_artifact' );
		expect( names ).not.toContain( 'studio_present' );
		const namesWithArtifacts = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).map( ( tool ) => tool.name );
		const studioPresent = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( tool ) => tool.name === 'studio_present' );
		expect( namesWithArtifacts ).not.toContain( 'show_artifact' );
		expect( namesWithArtifacts ).toContain( 'studio_present' );
		expect( namesWithArtifacts ).toContain( 'site_create' );
		expect( namesWithArtifacts ).toContain( 'wp_cli' );
		expect( studioPresent?.description ).toContain( '- site-code-scratchpad:' );
		expect( studioPresent?.description ).toContain( 'after any successful Write or Edit' );
		expect( studioPresent?.description ).toContain(
			'call studio_present with exactly one note widget'
		);
		expect( studioPresent?.description ).toContain( '- scratchpad:' );
		expect( studioPresent?.description ).not.toContain( previousScratchpadWidgetType );
		expect( studioPresent?.description ).toContain( '- saved-local-media:' );
		expect( studioPresent?.description ).toContain(
			'For generated SVGs, write a complete .svg file'
		);
		expect( studioPresent?.description ).not.toContain( '- drawing:' );
	} );

	it( 'refresh_browser emits a preview.reload event and is registered', async () => {
		expect( studioToolDefinitions.map( ( tool ) => tool.name ) ).toContain( 'refresh_browser' );
		const emitEventMock = vi.mocked( emitEvent );
		emitEventMock.mockClear();
		const result = await getTool( 'refresh_browser' ).rawHandler( {} as never );
		expect( getTextContent( result ) ).toBe( 'Reloaded the site preview.' );
		expect( emitEventMock ).toHaveBeenCalledWith(
			expect.objectContaining( { type: 'preview.reload' } )
		);
	} );

	it( 'omits refresh_browser when no Studio UI preview is attached', () => {
		const names = resolveStudioToolDefinitions( { studioUiAttached: false } ).map(
			( tool ) => tool.name
		);

		expect( names ).not.toContain( 'refresh_browser' );
	} );

	it( 'does not expose Studio UI presentation tools in remote sessions', () => {
		const names = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
			remoteSession: true,
			studioUiAttached: false,
		} ).map( ( tool ) => tool.name );

		expect( names ).toContain( 'share_screenshot' );
		expect( names ).not.toContain( 'studio_present' );
		expect( names ).not.toContain( 'refresh_browser' );
	} );

	it( 'keeps screenshot presentation guidance out of the screenshot tool description', () => {
		const takeScreenshot = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( tool ) => tool.name === 'take_screenshot' );
		const studioPresent = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( tool ) => tool.name === 'studio_present' );
		expect( takeScreenshot?.description ).not.toContain( 'ready-to-use media widget payload' );
		expect( takeScreenshot?.description ).not.toContain(
			'This does not automatically show the screenshot to the user'
		);
		expect( takeScreenshot?.description ).not.toContain(
			'Do not use a site-preview widget as a substitute for the screenshot'
		);
		expect( studioPresent?.description ).toContain( 'Never call studio_present for a screenshot' );
	} );

	it( 'keeps take_screenshot output compact while returning artifacts structurally', async () => {
		const screenshotBuffer = Buffer.from( 'fake-jpeg' );
		mockScreenshotBrowser( createMockPage( { buffer: screenshotBuffer, documentHeight: 2400 } ) );
		const progressMessages: string[] = [];
		setProgressCallback( ( message ) => {
			progressMessages.push( message );
		} );

		const result = await getTool( 'take_screenshot' ).rawHandler( {
			url: 'http://localhost:8903/story-time',
		} as never );

		// Terminal users have no artifact rendering; the saved-file progress
		// line is their only handle on the capture.
		expect( progressMessages ).toContainEqual(
			expect.stringMatching(
				/^Saved desktop screenshot to file:\/\/.*screenshot-desktop-[0-9a-f]{8}\.jpg$/
			)
		);
		const text = getTextContent( result );
		expect( text ).toContain( 'Screenshot captured' );
		expect( text ).toContain( 'desktop: captured full page (2400px tall)' );
		expect( text ).not.toContain( 'mediaWidgetPayload' );
		expect( text ).not.toContain( 'When this screenshot is useful to show the user' );
		expect( text ).not.toContain( 'Path:' );
		expect( text ).not.toContain( 'File URL:' );
		expect( result.content[ 1 ] ).toEqual( {
			type: 'image',
			data: screenshotBuffer.toString( 'base64' ),
			mimeType: 'image/jpeg',
		} );

		const artifacts = getScreenshotArtifacts( result );
		expect( artifacts[ 0 ].widgetProps.source.name ).toMatch(
			/^screenshot-desktop-[0-9a-f]{8}\.jpg$/
		);
		await cleanUpScreenshotArtifacts( artifacts );
	} );

	it( 'returns no artifacts when take_screenshot is called with display: false', async () => {
		const screenshotBuffer = Buffer.from( 'internal-jpeg' );
		mockScreenshotBrowser( createMockPage( { buffer: screenshotBuffer, documentHeight: 900 } ) );
		const progressMessages: string[] = [];
		setProgressCallback( ( message ) => {
			progressMessages.push( message );
		} );

		const result = await getTool( 'take_screenshot' ).rawHandler( {
			url: 'http://localhost:8903/story-time',
			display: false,
		} as never );

		// Nothing to emit into the chat, but the model still gets the image
		// for its own verification.
		expect( result.studioArtifacts ).toBeUndefined();
		expect( result.content[ 1 ] ).toEqual( {
			type: 'image',
			data: screenshotBuffer.toString( 'base64' ),
			mimeType: 'image/jpeg',
		} );

		const savedLine = progressMessages.find( ( message ) => message.startsWith( 'Saved ' ) );
		expect( savedLine ).toBeDefined();
		await rm(
			path.dirname( fileURLToPath( savedLine!.slice( savedLine!.indexOf( 'file://' ) ) ) ),
			{
				recursive: true,
				force: true,
			}
		);
	} );

	it( 'can capture desktop and mobile screenshots in one take_screenshot call', async () => {
		const desktopBuffer = Buffer.from( 'desktop-jpeg' );
		const mobileBuffer = Buffer.from( 'mobile-jpeg' );
		const { newPage } = mockScreenshotBrowser(
			createMockPage( { buffer: desktopBuffer, documentHeight: 2400 } ),
			createMockPage( { buffer: mobileBuffer, documentHeight: 2400 } )
		);

		const result = await getTool( 'take_screenshot' ).rawHandler( {
			url: 'http://localhost:8903/story-time',
			viewport: 'all',
		} as never );
		const text = getTextContent( result );

		expect( text ).toContain( 'Screenshots captured:' );
		expect( text ).toContain( '- desktop: captured full page (2400px tall)' );
		expect( text ).toContain( '- mobile: captured full page (2400px tall)' );
		expect( text ).not.toContain( 'mediaWidgetPayload' );
		expect( newPage ).toHaveBeenCalledTimes( 2 );
		expect( result.content.slice( 1 ) ).toEqual( [
			{
				type: 'image',
				data: desktopBuffer.toString( 'base64' ),
				mimeType: 'image/jpeg',
			},
			{
				type: 'image',
				data: mobileBuffer.toString( 'base64' ),
				mimeType: 'image/jpeg',
			},
		] );

		const artifacts = getScreenshotArtifacts( result );
		try {
			expect( artifacts.map( ( artifact ) => artifact.widgetProps.source.name ) ).toEqual( [
				expect.stringMatching( /^screenshot-desktop-[0-9a-f]{8}\.jpg$/ ),
				expect.stringMatching( /^screenshot-mobile-[0-9a-f]{8}\.jpg$/ ),
			] );
		} finally {
			await cleanUpScreenshotArtifacts( artifacts );
		}
	} );

	it( 'can capture light and dark screenshots in one take_screenshot call', async () => {
		const lightBuffer = Buffer.from( 'light-jpeg' );
		const darkBuffer = Buffer.from( 'dark-jpeg' );
		const lightPage = createMockPage( { buffer: lightBuffer, documentHeight: 1600 } );
		const darkPage = createMockPage( { buffer: darkBuffer, documentHeight: 1600 } );
		mockScreenshotBrowser( lightPage, darkPage );

		const result = await getTool( 'take_screenshot' ).rawHandler( {
			url: 'http://localhost:8903/story-time',
			colorScheme: 'all',
		} as never );
		const text = getTextContent( result );

		expect( text ).toContain( '- desktop light: captured full page (1600px tall)' );
		expect( text ).toContain( '- desktop dark: captured full page (1600px tall)' );
		expect( lightPage.emulateMedia ).toHaveBeenCalledWith( {
			reducedMotion: 'reduce',
			colorScheme: 'light',
		} );
		expect( darkPage.emulateMedia ).toHaveBeenCalledWith( {
			reducedMotion: 'reduce',
			colorScheme: 'dark',
		} );
		expect( result.content.slice( 1 ) ).toEqual( [
			{
				type: 'image',
				data: lightBuffer.toString( 'base64' ),
				mimeType: 'image/jpeg',
			},
			{
				type: 'image',
				data: darkBuffer.toString( 'base64' ),
				mimeType: 'image/jpeg',
			},
		] );

		const artifacts = getScreenshotArtifacts( result );
		try {
			expect( artifacts.map( ( artifact ) => artifact.widgetProps.source.name ) ).toEqual( [
				expect.stringMatching( /^screenshot-desktop-light-[0-9a-f]{8}\.jpg$/ ),
				expect.stringMatching( /^screenshot-desktop-dark-[0-9a-f]{8}\.jpg$/ ),
			] );
			expect( artifacts[ 1 ].widgetProps.alt ).toBe(
				'Screenshot of http://localhost:8903/story-time (desktop dark)'
			);
		} finally {
			await cleanUpScreenshotArtifacts( artifacts );
		}
	} );

	it( 'inspect_design returns rendered DOM facts for the requested selectors', async () => {
		const report = [
			{
				selector: '.wp-block-button__link',
				matchCount: 1,
				matches: [
					{
						tag: 'a',
						classes: [ 'wp-block-button__link', 'wp-element-button' ],
						boundingBox: { x: 0, y: 0, width: 120, height: 44 },
						computedStyle: { 'background-color': 'rgb(0, 0, 0)' },
						ancestors: [ 'div.wp-block-button' ],
					},
				],
			},
		];
		const page = {
			emulateMedia: vi.fn(),
			goto: vi.fn(),
			waitForLoadState: vi.fn().mockResolvedValue( undefined ),
			evaluate: vi.fn().mockResolvedValueOnce( undefined ).mockResolvedValueOnce( report ),
			hover: vi.fn(),
			mouse: { move: vi.fn() },
			close: vi.fn(),
		};
		const browser = { newPage: vi.fn().mockResolvedValue( page ) };
		vi.mocked( getSharedBrowser ).mockResolvedValue( browser as never );

		const result = await getTool( 'inspect_design' ).rawHandler( {
			url: 'http://localhost:8903/',
			selectors: [ '.wp-block-button__link' ],
		} as never );

		const parsed = JSON.parse( getTextContent( result )! );
		expect( parsed.viewport ).toBe( 'desktop' );
		expect( parsed.viewportWidth ).toBe( 1040 );
		expect( parsed.selectors[ 0 ].matchCount ).toBe( 1 );
		expect( parsed.selectors[ 0 ].matches[ 0 ].computedStyle[ 'background-color' ] ).toBe(
			'rgb(0, 0, 0)'
		);
		expect( parsed.hover ).toBeUndefined();
		expect( page.hover ).not.toHaveBeenCalled();
		expect( page.close ).toHaveBeenCalled();
	} );

	it( 'inspect_design can force a dark color scheme', async () => {
		const report = [ { selector: '.hero', matchCount: 1, matches: [] } ];
		const page = {
			emulateMedia: vi.fn(),
			goto: vi.fn(),
			waitForLoadState: vi.fn().mockResolvedValue( undefined ),
			evaluate: vi.fn().mockResolvedValueOnce( undefined ).mockResolvedValueOnce( report ),
			hover: vi.fn(),
			mouse: { move: vi.fn() },
			close: vi.fn(),
		};
		const browser = { newPage: vi.fn().mockResolvedValue( page ) };
		vi.mocked( getSharedBrowser ).mockResolvedValue( browser as never );

		const result = await getTool( 'inspect_design' ).rawHandler( {
			url: 'http://localhost:8903/',
			selectors: [ '.hero' ],
			colorScheme: 'dark',
		} as never );

		const parsed = JSON.parse( getTextContent( result )! );
		expect( parsed.colorScheme ).toBe( 'dark' );
		expect( page.emulateMedia ).toHaveBeenCalledWith( {
			reducedMotion: 'reduce',
			colorScheme: 'dark',
		} );
	} );

	it( 'inspect_design captures hover styles when includeHover is set', async () => {
		const report = [ { selector: '.wp-block-button__link', matchCount: 1, matches: [] } ];
		const page = {
			emulateMedia: vi.fn(),
			goto: vi.fn(),
			waitForLoadState: vi.fn().mockResolvedValue( undefined ),
			evaluate: vi
				.fn()
				.mockResolvedValueOnce( undefined )
				.mockResolvedValueOnce( report )
				.mockResolvedValueOnce( { 'background-color': 'rgb(255, 0, 0)' } ),
			hover: vi.fn().mockResolvedValue( undefined ),
			mouse: { move: vi.fn().mockResolvedValue( undefined ) },
			close: vi.fn(),
		};
		const browser = { newPage: vi.fn().mockResolvedValue( page ) };
		vi.mocked( getSharedBrowser ).mockResolvedValue( browser as never );

		const result = await getTool( 'inspect_design' ).rawHandler( {
			url: 'http://localhost:8903/',
			selectors: [ '.wp-block-button__link' ],
			viewport: 'mobile',
			includeHover: true,
		} as never );

		const parsed = JSON.parse( getTextContent( result )! );
		expect( parsed.viewport ).toBe( 'mobile' );
		expect( parsed.viewportWidth ).toBe( 390 );
		expect( page.hover ).toHaveBeenCalledWith( '.wp-block-button__link', expect.anything() );
		expect( parsed.hover[ 0 ].computedStyle[ 'background-color' ] ).toBe( 'rgb(255, 0, 0)' );
	} );

	it( 'emits explicit Studio widget artifacts from studio_present', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'studio_present' );
		expect( tool ).toBeDefined();

		const result = await executeTool( tool!, {
			message: 'Showing the draft plan.',
			widgets: [
				{
					type: 'note',
					widgetProps: { text: 'Draft the homepage hero next.', tone: 'yellow' },
				},
			],
		} );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'chat.artifact',
				artifact: expect.objectContaining( {
					widgets: [
						{
							type: 'note',
							widgetProps: { text: 'Draft the homepage hero next.', tone: 'yellow' },
						},
					],
				} ),
			} )
		);
		expect( getTextContent( result ) ).toBe( 'Showing the draft plan.' );
	} );

	it( 'accepts local SVG media widget artifacts from studio_present', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'studio_present' );
		expect( tool ).toBeDefined();

		const localMediaWidget = {
			type: 'media',
			widgetProps: {
				url: 'file:///tmp/rb-logo.svg',
				mediaKind: 'image',
				alt: 'RB logo SVG',
				mediaId: null,
				source: {
					type: 'local',
					path: '/tmp/rb-logo.svg',
					name: 'rb-logo.svg',
					mimeType: 'image/svg+xml',
				},
			},
		};

		await executeTool( tool!, {
			widgets: [ localMediaWidget ],
		} );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'chat.artifact',
				artifact: expect.objectContaining( {
					widgets: [ localMediaWidget ],
				} ),
			} )
		);
	} );

	it( 'accepts PDF widget artifacts from studio_present', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'studio_present' );
		expect( tool ).toBeDefined();

		const pdfWidget = {
			type: 'pdf',
			widgetProps: {
				url: 'https://example.com/brief.pdf',
				title: 'Brief',
				mediaId: null,
			},
		};

		await executeTool( tool!, {
			widgets: [ pdfWidget ],
		} );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'chat.artifact',
				artifact: expect.objectContaining( {
					widgets: [ pdfWidget ],
				} ),
			} )
		);
	} );

	it( 'accepts theme widget artifacts from studio_present', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'studio_present' );
		expect( tool ).toBeDefined();

		const themeWidgets = [
			{
				type: 'theme',
				widgetProps: { viewMode: 'stack' },
			},
			{
				type: 'theme-template',
				widgetProps: {
					templateId: 'twentytwentyfive//index',
					slug: 'index',
					title: 'Index',
					description: '',
					source: 'theme',
				},
			},
			{
				type: 'theme-styles',
				widgetProps: {
					palette: [
						{ slug: 'background', name: 'Background', color: '#ffffff' },
						{ slug: 'foreground', name: 'Foreground', color: '#111111' },
					],
					fontFamily: 'system-ui, sans-serif',
					textColor: '#111111',
					backgroundColor: '#ffffff',
				},
			},
			{
				type: 'theme-pattern',
				widgetProps: {
					patternId: 'twentytwentyfive/hero',
					title: 'Hero',
					content: '<!-- wp:cover /-->',
					source: 'theme',
				},
			},
			{
				type: 'color',
				widgetProps: { color: '#3858e9', title: 'Primary', format: 'hex' },
			},
		];

		await executeTool( tool!, {
			widgets: themeWidgets,
		} );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'chat.artifact',
				artifact: expect.objectContaining( {
					widgets: themeWidgets,
				} ),
			} )
		);
	} );

	it( 'rejects drawing widget artifacts from studio_present', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'studio_present' );
		expect( tool ).toBeDefined();

		await expect(
			executeTool( tool!, {
				widgets: [
					{
						type: 'drawing',
						widgetProps: { svg: '<svg viewBox="0 0 100 100"></svg>' },
					},
				],
			} )
		).rejects.toThrow( 'Unsupported widget type "drawing"' );
		expect( emitEvent ).not.toHaveBeenCalled();
	} );

	it( 'rejects invalid explicit Studio widget artifacts', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'studio_present' );
		expect( tool ).toBeDefined();

		await expect(
			executeTool( tool!, {
				widgets: [
					{
						type: 'page',
						widgetProps: { pageId: '123', tone: 'neutral' },
					},
				],
			} )
		).rejects.toThrow( 'Invalid widget at index 0' );
		expect( emitEvent ).not.toHaveBeenCalled();
	} );

	it( 'rejects Studio widget artifacts with tiny shape props', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'studio_present' );
		expect( tool ).toBeDefined();

		await expect(
			executeTool( tool!, {
				widgets: [
					{
						type: 'post-collection',
						widgetProps: {
							query: {
								postType: 'post',
								perPage: 5,
								status: 'publish',
								orderby: 'date',
								order: 'desc',
							},
						},
						shapeProps: { w: 1, h: 1 },
					},
				],
			} )
		).rejects.toThrow( 'shapeProps may only include numeric w and h between 80 and 3000' );
		expect( emitEvent ).not.toHaveBeenCalled();
	} );

	describe( 'share_screenshot gating', () => {
		it( 'omits share_screenshot when remoteSession is not set', () => {
			const names = resolveStudioToolDefinitions().map( ( tool ) => tool.name );
			expect( names ).not.toContain( 'share_screenshot' );
			expect( names ).toContain( 'take_screenshot' );
		} );

		it( 'omits share_screenshot when remoteSession is false', () => {
			const names = resolveStudioToolDefinitions( {
				remoteSession: false,
			} ).map( ( tool ) => tool.name );
			expect( names ).not.toContain( 'share_screenshot' );
		} );

		it( 'includes share_screenshot when remoteSession is true', () => {
			const names = resolveStudioToolDefinitions( {
				remoteSession: true,
			} ).map( ( tool ) => tool.name );
			expect( names ).toContain( 'share_screenshot' );
		} );

		it( 'can force dark mode when sharing a screenshot', async () => {
			const screenshotBuffer = Buffer.from( 'shared-png' );
			const page = createMockPage( { buffer: screenshotBuffer } );
			mockScreenshotBrowser( page );

			const result = await getTool( 'share_screenshot' ).rawHandler( {
				url: 'http://localhost:8903/',
				colorScheme: 'dark',
			} as never );

			expect( page.emulateMedia ).toHaveBeenCalledWith( {
				reducedMotion: 'reduce',
				colorScheme: 'dark',
			} );
			expect( emitEvent ).toHaveBeenCalledWith(
				expect.objectContaining( {
					type: 'media.share',
					mimeType: 'image/png',
					dataBase64: screenshotBuffer.toString( 'base64' ),
				} )
			);
			expect( getTextContent( result ) ).toContain( 'dark mode' );
		} );
	} );

	it( 'creates previews for a resolved local site', async () => {
		const result = await getTool( 'preview_create' ).rawHandler( {
			nameOrPath: 'My Site',
		} as never );

		expect( runCreatePreviewCommand ).toHaveBeenCalledWith( '/sites/my-site' );
		expect( getTextContent( result ) ).toContain( 'Preview site created for "My Site".' );
	} );

	it( 'emits a site preview artifact when site_create succeeds with chat artifacts enabled', async () => {
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'site_create' );
		expect( tool ).toBeDefined();

		const result = await executeTool( tool!, { name: 'My Site' } );

		expect( runCreateSiteCommand ).toHaveBeenCalledWith(
			expect.stringMatching( /my-site$/ ),
			expect.objectContaining( {
				name: 'My Site',
				noStart: false,
				skipBrowser: true,
			} )
		);
		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'chat.artifact',
				artifact: expect.objectContaining( {
					widgets: [
						{
							type: 'site-preview',
							widgetProps: expect.objectContaining( {
								path: '/',
								siteId: 'site-123',
								siteName: 'My Site',
								sitePath: '/sites/my-site',
							} ),
						},
					],
				} ),
			} )
		);
		expect( getTextContent( result ) ).toContain( '"id": "site-123"' );
		expect( getTextContent( result ) ).toContain( '"name": "My Site"' );
	} );

	describe( 'withChatArtifactEmission', () => {
		const widget = { type: 'media', widgetProps: { mediaKind: 'image' } };
		const makeFakeTool = () => {
			const execute = vi.fn().mockResolvedValue( {
				content: [ { type: 'text', text: 'ok' } ],
				details: { studioArtifacts: [ widget ] },
			} );
			return {
				tool: { name: 'fake_tool', execute } as unknown as AnyStudioAgentTool,
				execute,
			};
		};

		it( 'forwards execute arguments and preserves details when emitting', async () => {
			const { tool, execute } = makeFakeTool();
			const signal = new AbortController().signal;
			const onUpdate = () => {};

			const wrapped = withChatArtifactEmission( tool, true );
			const result = await wrapped.execute( 'tool-call-9', { a: 1 } as never, signal, onUpdate );

			expect( execute ).toHaveBeenCalledWith( 'tool-call-9', { a: 1 }, signal, onUpdate );
			expect( result.details ).toEqual( { studioArtifacts: [ widget ] } );
			expect( emitEvent ).toHaveBeenCalledWith(
				expect.objectContaining( {
					type: 'chat.artifact',
					artifact: expect.objectContaining( { widgets: [ widget ] } ),
				} )
			);
		} );

		it( 'returns the tool unchanged when chat artifacts are disabled', () => {
			const { tool } = makeFakeTool();
			expect( withChatArtifactEmission( tool, false ) ).toBe( tool );
		} );

		it( 'does not fail the tool result when artifact emission throws', async () => {
			const { tool } = makeFakeTool();
			const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
			setChatArtifactCallback( () => {
				throw new Error( 'disk full' );
			} );

			try {
				const wrapped = withChatArtifactEmission( tool, true );
				const result = await wrapped.execute(
					'tool-call-9',
					{} as never,
					new AbortController().signal,
					() => {}
				);

				expect( result.content ).toEqual( [ { type: 'text', text: 'ok' } ] );
				expect( warnSpy ).toHaveBeenCalledWith(
					expect.stringContaining( '[chat-artifacts] failed to emit artifact for fake_tool' ),
					expect.any( Error )
				);
			} finally {
				setChatArtifactCallback( null );
				warnSpy.mockRestore();
			}
		} );

		it( 'emits site_create artifacts when wrapped directly (remote tool list)', async () => {
			const wrapped = withChatArtifactEmission( createSiteTool, true );

			await executeTool( wrapped, { name: 'My Site' } );

			expect( emitEvent ).toHaveBeenCalledWith(
				expect.objectContaining( {
					type: 'chat.artifact',
					artifact: expect.objectContaining( {
						widgets: [
							expect.objectContaining( {
								type: 'site-preview',
								widgetProps: expect.objectContaining( { siteId: 'site-123' } ),
							} ),
						],
					} ),
				} )
			);
		} );
	} );

	it( 'notifies JSON-mode callers when site_create selects the created site', async () => {
		const onSiteSelected = vi.fn();
		setLocalSiteSelectedCallback( onSiteSelected );

		await getTool( 'site_create' ).rawHandler( { name: 'My Site' } as never );

		expect( onSiteSelected ).toHaveBeenCalledWith( {
			id: 'site-123',
			name: 'My Site',
			path: '/sites/my-site',
			running: true,
		} );
	} );

	it( 'lists previews as JSON for a resolved local site', async () => {
		vi.mocked( runListPreviewCommand ).mockResolvedValue( undefined );

		const result = await getTool( 'preview_list' ).rawHandler( { nameOrPath: 'My Site' } as never );

		expect( runListPreviewCommand ).toHaveBeenCalledWith( '/sites/my-site', 'json' );
		// No snapshots emitted by the command -> the tool reports an empty list.
		expect( JSON.parse( getTextContent( result ) ?? 'null' ) ).toEqual( [] );
	} );

	it( 'enrichPreviewListOutput tags each preview with type "preview" and an expiry flag', () => {
		const dayMs = 24 * 60 * 60 * 1000;
		const futureDate = Date.now() + 3 * dayMs;
		const enriched = JSON.parse(
			enrichPreviewListOutput(
				JSON.stringify( [
					{
						url: 'demo-studio.wp.build',
						atomicSiteId: 12345,
						localSiteId: 'site-123',
						date: futureDate,
						name: 'My Site',
					},
				] )
			)
		);
		expect( enriched ).toEqual( [
			{
				type: 'preview',
				name: 'My Site',
				url: 'https://demo-studio.wp.build',
				atomicSiteId: 12345,
				localSiteId: 'site-123',
				date: futureDate,
				isExpired: false,
			},
		] );
	} );

	it( 'tags connected remote sites with type "wpcom-remote"', async () => {
		vi.mocked( getConnectedWpcomSitesForLocalSite ).mockResolvedValue( [
			{
				id: 111,
				localSiteId: 'site-123',
				name: 'My Production Site',
				url: 'https://myprod.wordpress.com',
				isStaging: false,
				isPressable: false,
				environmentType: 'production',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		] );

		const result = await getTool( 'site_connected_remote_sites' ).rawHandler( {
			nameOrPath: 'My Site',
		} as never );

		expect( getConnectedWpcomSitesForLocalSite ).toHaveBeenCalledWith( 'site-123' );
		const parsed = JSON.parse( getTextContent( result ) ?? '[]' );
		expect( parsed ).toEqual( [
			{
				type: 'wpcom-remote',
				id: 111,
				name: 'My Production Site',
				url: 'https://myprod.wordpress.com',
				isStaging: false,
				isPressable: false,
				environmentType: 'production',
				syncSupport: 'already-connected',
				lastPushTimestamp: null,
				lastPullTimestamp: null,
			},
		] );
	} );

	it( 'updates previews with a normalized hostname', async () => {
		const result = await getTool( 'preview_update' ).rawHandler( {
			nameOrPath: 'My Site',
			host: 'https://demo.wordpress.com/',
			overwrite: true,
		} as never );

		expect( runUpdatePreviewCommand ).toHaveBeenCalledWith(
			'/sites/my-site',
			'demo.wordpress.com',
			true
		);
		expect( getTextContent( result ) ).toContain(
			'Preview site "demo.wordpress.com" updated from "My Site".'
		);
	} );

	it( 'returns preview delete failures as tool errors', async () => {
		vi.mocked( runDeletePreviewCommand ).mockImplementation( async () => {
			process.exitCode = 1;
			console.log( 'Failed to delete preview site' );
		} );

		await expect(
			getTool( 'preview_delete' ).rawHandler( {
				host: 'https://demo.wordpress.com/',
			} as never )
		).rejects.toThrow( 'Failed to delete preview site' );

		expect( runDeletePreviewCommand ).toHaveBeenCalledWith(
			PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT,
			'demo.wordpress.com'
		);
	} );

	it( 'restores the previous progress callback after running a preview tool', async () => {
		const previousCallback = vi.fn();
		setProgressCallback( previousCallback );

		await getTool( 'preview_create' ).rawHandler( { nameOrPath: 'My Site' } as never );

		expect( getProgressCallback() ).toBe( previousCallback );
	} );

	it( 'forwards progress messages to the previous callback during command execution', async () => {
		const previousCallback = vi.fn();
		setProgressCallback( previousCallback );

		vi.mocked( runCreatePreviewCommand ).mockImplementation( async () => {
			const currentCallback = getProgressCallback();
			currentCallback?.( 'Creating preview…' );
			currentCallback?.( 'Almost done…' );
		} );

		await getTool( 'preview_create' ).rawHandler( { nameOrPath: 'My Site' } as never );

		expect( previousCallback ).toHaveBeenCalledWith( 'Creating preview…', undefined );
		expect( previousCallback ).toHaveBeenCalledWith( 'Almost done…', undefined );
	} );

	it( 'coalesces progress updates in captured command output', async () => {
		const previousCallback = vi.fn();
		setProgressCallback( previousCallback );

		const result = await captureCommandOutput( async () => {
			const currentCallback = getProgressCallback();
			currentCallback?.( 'Applying changes… (74%)' );
			currentCallback?.( 'Applying changes… (75%)', true );
			currentCallback?.( 'Applying changes… (76%)', true );
			currentCallback?.( 'Push complete' );
		} );

		expect( result.progressOutput ).toBe( 'Applying changes… (76%)\nPush complete' );
		expect( previousCallback ).toHaveBeenCalledWith( 'Applying changes… (75%)', true );
		expect( previousCallback ).toHaveBeenCalledWith( 'Applying changes… (76%)', true );
	} );

	it( 'rejects shell syntax in wp_cli post content before dispatching to WP-CLI', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );

		await expect(
			getTool( 'wp_cli' ).rawHandler( {
				nameOrPath: 'My Site',
				command:
					'post create --post_type=page --post_title=Home --post_content="$(cat /tmp/one-page-content.txt)"',
			} as never )
		).rejects.toThrow( /does not run in a shell/ );

		expect( runWpCliCommandWithMessaging ).not.toHaveBeenCalled();
	} );

	it( 'treats unquoted post_content as a single trailing literal argument', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: `post create --post_type=page --post_title="About" --post_status=publish --post_content=<!-- wp:paragraph -->
<p>Hello world</p>
<!-- /wp:paragraph -->`,
		} as never );

		expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith( mockSite, [
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--post_status=publish',
			'--post_content=<!-- wp:paragraph -->\n<p>Hello world</p>\n<!-- /wp:paragraph -->',
		] );
	} );

	it( 'strips matching outer quotes from trailing post_content', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: 'post create --post_type=page --post_title="About" --post_content="Hello world"',
		} as never );

		expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith( mockSite, [
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--post_content=Hello world',
		] );
	} );

	it( 'keeps flags after quoted post_content out of the page content', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command:
				'post create --post_type=page --post_title="About" --post_content="Hello world" --porcelain',
		} as never );

		expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith( mockSite, [
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--post_content=Hello world',
			'--porcelain',
		] );
	} );

	it( 'keeps porcelain after empty quoted post_content out of the page content', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: 'post create --post_type=page --post_title="About" --post_content="" --porcelain',
		} as never );

		expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith( mockSite, [
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--post_content=',
			'--porcelain',
		] );
	} );

	it( 'emits a page artifact when wp_cli creates a page with chat artifacts enabled', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'wp_cli' );
		expect( tool ).toBeDefined();

		await executeTool( tool!, {
			nameOrPath: 'My Site',
			command: 'post create --post_type=page --post_title="About" --porcelain',
		} );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'chat.artifact',
				artifact: expect.objectContaining( {
					widgets: [ { type: 'page', widgetProps: { pageId: 123, tone: 'neutral' } } ],
				} ),
			} )
		);
	} );

	it( 'emits automatic tool artifacts without filtering by widget type', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);
		const tool = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( definition ) => definition.name === 'wp_cli' );
		expect( tool ).toBeDefined();

		await executeTool( tool!, {
			nameOrPath: 'My Site',
			command: 'post create --post_title="Hello" --porcelain',
		} );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'chat.artifact',
				artifact: expect.objectContaining( {
					widgets: [ { type: 'post', widgetProps: { postId: 123 } } ],
				} ),
			} )
		);
	} );

	it( 'rejects typographic dash options before dispatching to WP-CLI', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );

		await expect(
			getTool( 'wp_cli' ).rawHandler( {
				nameOrPath: 'My Site',
				command:
					'post create --post_type=page --post_title="About" --post_content="Hello world" –porcelain',
			} as never )
		).rejects.toThrow( /typographic dash/ );

		expect( runWpCliCommandWithMessaging ).not.toHaveBeenCalled();
	} );

	describe( 'scaffold_theme', () => {
		let tempSiteRoot: string;
		let scaffoldSite: typeof mockSite;

		beforeEach( async () => {
			tempSiteRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-scaffold-theme-' ) );
			await mkdir( path.join( tempSiteRoot, 'wp-content', 'themes' ), { recursive: true } );
			scaffoldSite = { ...mockSite, path: tempSiteRoot };
			vi.mocked( readCliConfig ).mockResolvedValue( {
				sites: [ scaffoldSite ],
			} as Awaited< ReturnType< typeof readCliConfig > > );
			vi.mocked( getSiteByFolder ).mockResolvedValue( scaffoldSite );
		} );

		afterEach( async () => {
			await rm( tempSiteRoot, { recursive: true, force: true } );
		} );

		it( 'is registered in the tool definitions', () => {
			expect( studioToolDefinitions.map( ( tool ) => tool.name ) ).toContain( 'scaffold_theme' );
		} );

		it( 'creates the expected files and directories under wp-content/themes/<slug>', async () => {
			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
			} as never );

			const themeDir = path.join( tempSiteRoot, 'wp-content', 'themes', 'acme-studio' );
			const expectedFiles = [
				'style.css',
				'theme.json',
				'functions.php',
				'templates/index.html',
				'templates/single.html',
				'templates/page.html',
				'templates/archive.html',
				'templates/404.html',
				'parts/header.html',
				'parts/footer.html',
			];
			for ( const rel of expectedFiles ) {
				await expect( stat( path.join( themeDir, rel ) ) ).resolves.toBeDefined();
			}

			const fontsDir = await stat( path.join( themeDir, 'assets', 'fonts' ) );
			expect( fontsDir.isDirectory() ).toBe( true );
			const patternsDir = await stat( path.join( themeDir, 'patterns' ) );
			expect( patternsDir.isDirectory() ).toBe( true );

			const styleCss = await readFile( path.join( themeDir, 'style.css' ), 'utf8' );
			expect( styleCss ).toContain( 'Theme Name: Acme Studio' );
			expect( styleCss ).toContain( 'Text Domain: acme-studio' );
			expect( styleCss ).toContain( 'scaffolded by Studio Code' );
			expect( styleCss ).not.toContain( 'Template:' );
			expect( styleCss ).toContain( '.wp-site-blocks > * + * {' );
			expect( styleCss ).toContain( 'margin-block-start: 0;' );

			const themeJson = JSON.parse(
				await readFile( path.join( themeDir, 'theme.json' ), 'utf8' )
			) as Record< string, unknown >;
			expect( themeJson.version ).toBe( 3 );
			expect( ( themeJson.settings as Record< string, unknown > ).appearanceTools ).toBe( true );

			const functionsPhp = await readFile( path.join( themeDir, 'functions.php' ), 'utf8' );
			expect( functionsPhp ).toContain( "'acme-studio-style'" );
			expect( functionsPhp ).toContain( "add_editor_style( 'style.css' )" );

			expect( getTextContent( result ) ).toContain(
				"Block theme 'Acme Studio' scaffolded at wp-content/themes/acme-studio/."
			);
			expect( getTextContent( result ) ).toContain( 'wp theme activate acme-studio' );
		} );

		it( 'honors an explicit slug argument over the derived one', async () => {
			await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
				slug: 'custom-slug',
			} as never );

			await expect(
				stat( path.join( tempSiteRoot, 'wp-content', 'themes', 'custom-slug' ) )
			).resolves.toBeDefined();
			await expect(
				stat( path.join( tempSiteRoot, 'wp-content', 'themes', 'acme-studio' ) )
			).rejects.toThrow();
		} );

		it( 'fails when the target theme directory already exists', async () => {
			await mkdir( path.join( tempSiteRoot, 'wp-content', 'themes', 'acme-studio' ), {
				recursive: true,
			} );
			await writeFile(
				path.join( tempSiteRoot, 'wp-content', 'themes', 'acme-studio', 'sentinel.txt' ),
				'preexisting'
			);

			await expect(
				getTool( 'scaffold_theme' ).rawHandler( {
					nameOrPath: scaffoldSite.name,
					name: 'Acme Studio',
				} as never )
			).rejects.toThrow( /already exists/ );

			// Pre-existing file is untouched.
			const sentinel = await readFile(
				path.join( tempSiteRoot, 'wp-content', 'themes', 'acme-studio', 'sentinel.txt' ),
				'utf8'
			);
			expect( sentinel ).toBe( 'preexisting' );
		} );

		it( 'fails when wp-content/themes is missing from the site', async () => {
			await rm( path.join( tempSiteRoot, 'wp-content' ), { recursive: true, force: true } );

			await expect(
				getTool( 'scaffold_theme' ).rawHandler( {
					nameOrPath: scaffoldSite.name,
					name: 'Acme Studio',
				} as never )
			).rejects.toThrow( /wp-content\/themes directory not found/ );
		} );

		it( 'rejects invalid explicit slugs', async () => {
			await expect(
				getTool( 'scaffold_theme' ).rawHandler( {
					nameOrPath: scaffoldSite.name,
					name: 'Acme Studio',
					slug: 'Not Valid!',
				} as never )
			).rejects.toThrow( /slug must contain only/ );
		} );

		it( 'rejects empty theme names', async () => {
			await expect(
				getTool( 'scaffold_theme' ).rawHandler( {
					nameOrPath: scaffoldSite.name,
					name: '   ',
				} as never )
			).rejects.toThrow( /name must not be empty/ );
		} );

		it( 'activates the theme by default when the site is running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( {
				name: scaffoldSite.id,
				pmId: 1,
				status: 'online',
				pid: 1234,
				runtime: SITE_RUNTIME_PLAYGROUND,
			} );
			vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
				mockWpCliResponse( { stdout: "Success: Switched to 'Acme Studio' theme." } ) as never
			);

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
			} as never );

			expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith( scaffoldSite, [
				'theme',
				'activate',
				'acme-studio',
			] );
			expect( getTextContent( result ) ).toContain(
				"Activated: Success: Switched to 'Acme Studio' theme."
			);
			expect( getTextContent( result ) ).not.toContain( 'Activation skipped' );
		} );

		it( 'skips activation when activate is false', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( {
				name: scaffoldSite.id,
				pmId: 1,
				status: 'online',
				pid: 1234,
				runtime: SITE_RUNTIME_PLAYGROUND,
			} );

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
				activate: false,
			} as never );

			expect( runWpCliCommandWithMessaging ).not.toHaveBeenCalled();
			expect( getTextContent( result ) ).toContain(
				'Activate with: wp theme activate acme-studio'
			);
		} );

		it( 'reports activation skipped when the site is not running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( undefined );

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
			} as never );

			expect( runWpCliCommandWithMessaging ).not.toHaveBeenCalled();
			expect( getTextContent( result ) ).toContain( 'Activation skipped:' );
			expect( getTextContent( result ) ).toContain( 'Site is not running' );
			expect( getTextContent( result ) ).toContain(
				'Activate manually with: wp theme activate acme-studio'
			);
		} );

		it( 'reports activation failure when WP-CLI returns a non-zero exit code', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( {
				name: scaffoldSite.id,
				pmId: 1,
				status: 'online',
				pid: 1234,
				runtime: SITE_RUNTIME_PLAYGROUND,
			} );
			vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
				mockWpCliResponse( { stderr: 'Error: stylesheet missing.', exitCode: 1 } ) as never
			);

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
			} as never );

			expect( getTextContent( result ) ).toContain(
				'Activation skipped: WP-CLI exited with code 1'
			);
			expect( getTextContent( result ) ).toContain( 'Error: stylesheet missing.' );
		} );

		describe( 'child themes (parentTheme)', () => {
			async function installParentTheme( slug: string, styleCss?: string ) {
				const parentDir = path.join( tempSiteRoot, 'wp-content', 'themes', slug );
				await mkdir( parentDir, { recursive: true } );
				await writeFile(
					path.join( parentDir, 'style.css' ),
					styleCss ?? `/*\nTheme Name: ${ slug }\n*/\n`,
					'utf8'
				);
			}

			it( 'scaffolds a minimal child theme when parentTheme is given', async () => {
				await installParentTheme( 'ollie' );

				const result = await getTool( 'scaffold_theme' ).rawHandler( {
					nameOrPath: scaffoldSite.name,
					name: 'Ollie Child',
					parentTheme: 'ollie',
				} as never );

				const themeDir = path.join( tempSiteRoot, 'wp-content', 'themes', 'ollie-child' );

				const styleCss = await readFile( path.join( themeDir, 'style.css' ), 'utf8' );
				expect( styleCss ).toContain( 'Theme Name: Ollie Child' );
				expect( styleCss ).toContain( 'Template: ollie' );
				expect( styleCss ).toContain( 'scaffolded by Studio Code' );
				expect( styleCss ).not.toContain( '.wp-site-blocks' );

				const themeJson = JSON.parse(
					await readFile( path.join( themeDir, 'theme.json' ), 'utf8' )
				) as Record< string, unknown >;
				expect( themeJson.version ).toBe( 3 );
				expect( themeJson.settings ).toBeUndefined();

				const functionsPhp = await readFile( path.join( themeDir, 'functions.php' ), 'utf8' );
				expect( functionsPhp ).toContain(
					"'ollie-parent-style',\n\t\tget_template_directory_uri() . '/style.css'"
				);
				expect( functionsPhp ).toContain(
					"'ollie-child-style',\n\t\tget_stylesheet_directory_uri() . '/style.css',\n\t\tarray( 'ollie-parent-style' )"
				);
				expect( functionsPhp ).not.toContain( 'get_parent_theme_file_uri' );

				await expect( stat( path.join( themeDir, 'templates' ) ) ).rejects.toThrow();
				await expect( stat( path.join( themeDir, 'parts' ) ) ).rejects.toThrow();

				expect( getTextContent( result ) ).toContain(
					"Child theme 'Ollie Child' of 'ollie' scaffolded at wp-content/themes/ollie-child/."
				);
				expect( getTextContent( result ) ).toContain( "inherit from 'ollie'" );
			} );

			it( 'activates the child theme by default when the site is running', async () => {
				await installParentTheme( 'ollie' );
				vi.mocked( isServerRunning ).mockResolvedValue( {
					name: scaffoldSite.id,
					pmId: 1,
					status: 'online',
					pid: 1234,
					runtime: SITE_RUNTIME_PLAYGROUND,
				} );
				vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue(
					mockWpCliResponse( { stdout: "Success: Switched to 'Ollie Child' theme." } ) as never
				);

				await getTool( 'scaffold_theme' ).rawHandler( {
					nameOrPath: scaffoldSite.name,
					name: 'Ollie Child',
					parentTheme: 'ollie',
				} as never );

				expect( runWpCliCommandWithMessaging ).toHaveBeenCalledWith( scaffoldSite, [
					'theme',
					'activate',
					'ollie-child',
				] );
			} );

			it( 'fails when the parent theme is not installed', async () => {
				await expect(
					getTool( 'scaffold_theme' ).rawHandler( {
						nameOrPath: scaffoldSite.name,
						name: 'Ollie Child',
						parentTheme: 'ollie',
					} as never )
				).rejects.toThrow( /Parent theme 'ollie' is not installed/ );
			} );

			it( 'fails when the parent is itself a child theme', async () => {
				await installParentTheme(
					'ollie-child',
					'/*\nTheme Name: Ollie Child\nTemplate: ollie\n*/\n'
				);

				await expect(
					getTool( 'scaffold_theme' ).rawHandler( {
						nameOrPath: scaffoldSite.name,
						name: 'Grandchild',
						parentTheme: 'ollie-child',
					} as never )
				).rejects.toThrow( /grandchild themes.*parentTheme: 'ollie'/ );
			} );

			it( 'fails when parentTheme equals the child slug', async () => {
				await installParentTheme( 'ollie' );

				await expect(
					getTool( 'scaffold_theme' ).rawHandler( {
						nameOrPath: scaffoldSite.name,
						name: 'Ollie',
						slug: 'ollie',
						parentTheme: 'ollie',
					} as never )
				).rejects.toThrow( /must be different from the child theme slug/ );
			} );

			it( 'rejects invalid parent theme slugs', async () => {
				await expect(
					getTool( 'scaffold_theme' ).rawHandler( {
						nameOrPath: scaffoldSite.name,
						name: 'Ollie Child',
						parentTheme: 'Not Valid!',
					} as never )
				).rejects.toThrow( /Parent theme slug must contain only/ );
			} );
		} );
	} );
} );
