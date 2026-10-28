import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import { nodeHostServices } from '@studio/agent/node/node-host';
import { validateBlocks } from '@studio/agent/shared/block-validator';
import { generateImages } from '@studio/agent/shared/image-generation';
import {
	resolveStudioTools,
	studioToolDefinitions,
	withChatArtifactEmission,
	type StudioToolsOptions,
} from '@studio/agent/shared/tools';
import { createSiteTool } from '@studio/agent/shared/tools/create-site';
import {
	bindTool,
	LOCAL_CHANGE,
	READ_ONLY,
	REMOTE_READ,
	type AnyStudioAgentTool,
} from '@studio/agent/shared/tools/define-tool';
import { enrichPreviewListOutput } from '@studio/agent/shared/tools/list-previews';
import { createTakeScreenshotTool } from '@studio/agent/shared/tools/take-screenshot';
import { splitCommandArgs } from '@studio/agent/shared/tools/wp-cli';
import { createFakeHost, fakeSite } from './fake-host';
import type { StudioAgentHost } from '@studio/agent/shared/host';

vi.mock( '@studio/agent/shared/block-validator', () => ( {
	validateBlocks: vi.fn(),
} ) );

vi.mock( '@studio/agent/node/browser-utils', () => ( {
	getSharedBrowser: vi.fn(),
} ) );

vi.mock( '@studio/agent/shared/image-generation', async () => ( {
	...( await vi.importActual( '@studio/agent/shared/image-generation' ) ),
	generateImages: vi.fn(),
} ) );

describe( 'Studio AI MCP tools', () => {
	const mockSite = fakeSite;
	let host: StudioAgentHost;

	const getTool = ( name: string ) => {
		const tool = studioToolDefinitions( host ).find( ( definition ) => definition.name === name );
		expect( tool ).toBeDefined();
		return bindTool( tool!, host );
	};
	const withUi = () => {
		const ui = { showArtifact: vi.fn(), reloadPreview: vi.fn() };
		host.ui = ui;
		return ui;
	};

	const getTextContent = ( result: { content?: Array< { type: string; text?: string } > } ) => {
		const firstContent = result.content?.[ 0 ];
		return firstContent && 'text' in firstContent ? firstContent.text : undefined;
	};
	const executeTool = ( tool: AnyStudioAgentTool, args: Record< string, unknown > ) =>
		tool.execute( 'tool-call-1', args as never, new AbortController().signal, () => {} );
	const createMockPage = ( {
		buffer,
		documentHeight,
		scaledBuffer = buffer,
	}: {
		buffer: Buffer;
		documentHeight?: number;
		scaledBuffer?: Buffer;
	} ) => ( {
		emulateMedia: vi.fn(),
		goto: vi.fn(),
		waitForLoadState: vi.fn().mockResolvedValue( undefined ),
		evaluate: vi.fn( async ( _script: unknown, args?: { source?: string } ) =>
			args?.source ? scaledBuffer.toString( 'base64' ) : documentHeight
		),
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
	};
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
		// The Node pages over a faked Playwright browser.
		host = { ...createFakeHost( os.tmpdir() ), pages: nodeHostServices().pages };
	} );

	it( 'offers refresh_browser only when a Studio UI shows the preview', async () => {
		const names = () => resolveStudioTools( host ).map( ( tool ) => tool.name );
		expect( names() ).not.toContain( 'refresh_browser' );
		const ui = withUi();
		expect( names() ).toContain( 'refresh_browser' );

		await getTool( 'refresh_browser' ).rawHandler( {} as never );
		expect( ui.reloadPreview ).toHaveBeenCalled();
	} );

	it( 'marks only reads and non-destructive local changes as safe to run without asking', () => {
		const annotations = Object.fromEntries(
			studioToolDefinitions( host ).map( ( tool ) => [ tool.name, tool.annotations ] )
		);
		expect( annotations.site_list ).toEqual( REMOTE_READ );
		expect( annotations.site_info ).toEqual( READ_ONLY );
		expect( annotations.scaffold_theme ).toEqual( LOCAL_CHANGE );
		for ( const name of [
			'site_delete',
			'site_push',
			'site_pull',
			'wp_cli',
			'wpcom_request',
			'validate_blocks',
		] ) {
			const { readOnlyHint, destructiveHint, openWorldHint } = annotations[ name ];
			expect( readOnlyHint || ( ! destructiveHint && ! openWorldHint ) ).toBe( false );
		}
	} );

	it( 'leaves out wpcom_request only for hosts that turn it off', () => {
		const names = ( options: StudioToolsOptions ) =>
			resolveStudioTools( host, options ).map( ( tool ) => tool.name );
		expect( names( {} ) ).toContain( 'wpcom_request' );
		expect( names( { wpcomRequest: false } ) ).not.toContain( 'wpcom_request' );
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
			host.pages,
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

	it( 'resolves a relative filePath against the site root', async () => {
		const siteDir = await mkdtemp( path.join( os.tmpdir(), 'studio-block-fix-' ) );
		const filePath = path.join( siteDir, 'tmp', 'page-home.html' );
		const fixedContent = '<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->';
		await mkdir( path.dirname( filePath ), { recursive: true } );
		await writeFile( filePath, '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->' );
		vi.mocked( host.sites.resolve ).mockResolvedValue( { ...mockSite, path: siteDir } );
		mockValidatedFix( fixedContent );

		try {
			const result = await getTool( 'validate_blocks' ).rawHandler( {
				nameOrPath: 'My Site',
				filePath: 'tmp/page-home.html',
			} as never );

			await expect( readFile( filePath, 'utf8' ) ).resolves.toBe( fixedContent );
			expect( getTextContent( result ) ).toContain( 'written to tmp/page-home.html' );
		} finally {
			await rm( siteDir, { recursive: true, force: true } );
		}
	} );

	it( 'pick_design offers options only when the user can be asked, and draws one otherwise', async () => {
		expect( getTool( 'pick_design' ).description ).not.toContain( 'options: 4' );
		expect(
			resolveStudioTools( host, { canAskUser: true } ).find( ( t ) => t.name === 'pick_design' )
				?.description
		).toContain( 'options: 4' );
		const text =
			getTextContent(
				await executeTool( getTool( 'pick_design' ), { catalog: 'layouts', options: 4 } )
			) ?? '';
		expect( text ).not.toContain( 'Option 1' );
		expect( text ).toContain( 'cannot be asked in this session' );
	} );

	describe( 'take_screenshot', () => {
		let screenshotDirectory: string;

		beforeEach( async () => {
			screenshotDirectory = await mkdtemp( path.join( os.tmpdir(), 'studio-screenshots-' ) );
			host.saveImage = nodeHostServices( {
				imagesDirectory: () => screenshotDirectory,
			} ).saveImage;
		} );

		afterEach( async () => {
			await rm( screenshotDirectory, { recursive: true, force: true } );
		} );

		it( 'sends the model tall captures scaled down to 2000 px and saves them in full', async () => {
			const desktop = Buffer.from( 'desktop-jpeg' );
			const scaledDesktop = Buffer.from( 'scaled-desktop-jpeg' );
			const mobile = Buffer.from( 'mobile-jpeg' );
			mockScreenshotBrowser(
				createMockPage( { buffer: desktop, documentHeight: 5662, scaledBuffer: scaledDesktop } ),
				createMockPage( { buffer: mobile, documentHeight: 1600 } )
			);

			const result = await getTool( 'take_screenshot' ).rawHandler( {
				url: 'http://localhost:8903/',
				viewport: 'all',
			} as never );

			const text = getTextContent( result );
			expect( text ).toContain( 'desktop: captured full page (5662px tall, shown at 367x2000)' );
			expect( text ).toContain( 'mobile: captured full page (1600px tall)' );
			expect( result.content.slice( 1 ) ).toEqual( [
				{ type: 'image', data: scaledDesktop.toString( 'base64' ), mimeType: 'image/jpeg' },
				{ type: 'image', data: mobile.toString( 'base64' ), mimeType: 'image/jpeg' },
			] );
			expect( result.studioArtifacts ).toHaveLength( 2 );
			const desktopFile = ( await readdir( screenshotDirectory ) ).find( ( name ) =>
				name.startsWith( 'screenshot-desktop-' )
			);
			await expect( readFile( path.join( screenshotDirectory, desktopFile! ) ) ).resolves.toEqual(
				desktop
			);
		} );

		it( 'sends no image to models that cannot view images, and no chat artifact when display is false', async () => {
			mockScreenshotBrowser(
				createMockPage( { buffer: Buffer.from( 'jpeg' ), documentHeight: 900 } )
			);

			const tool = bindTool( createTakeScreenshotTool( { visionEnabled: false } ), host );
			const result = await tool.rawHandler( {
				url: 'http://localhost:8903/',
				display: false,
			} as never );

			expect( result.content.map( ( block ) => block.type ) ).toEqual( [ 'text' ] );
			expect( result.studioArtifacts ).toBeUndefined();
		} );

		it( 'says when the user sees only the saved file path', async () => {
			const note = 'The user does not see this capture';
			const resultWith = async ( options: StudioToolsOptions, display?: boolean ) => {
				mockScreenshotBrowser(
					createMockPage( { buffer: Buffer.from( 'jpeg' ), documentHeight: 900 } )
				);
				const tool = resolveStudioTools( host, options ).find(
					( definition ) => definition.name === 'take_screenshot'
				);
				const result = await tool!.rawHandler( {
					url: 'http://localhost:8903/',
					display,
				} as never );
				return result.content.find( ( block ) => block.type === 'text' )?.text ?? '';
			};
			const imageLink = ( file: string ) => `file://${ file }`;
			expect( await resultWith( {} ) ).toContain( note );
			withUi();
			expect( await resultWith( {} ) ).not.toContain( note );
			host.ui = undefined;
			const linked = await resultWith( { imageLink } );
			expect( linked ).not.toContain( note );
			expect( linked ).toContain(
				`![Screenshot (desktop)](file://${ screenshotDirectory }${ path.sep }`
			);
			expect( await resultWith( { imageLink }, false ) ).not.toContain( '![' );
		} );
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

	it( 'emits a site preview artifact when site_create succeeds with chat artifacts enabled', async () => {
		const ui = withUi();
		const tool = resolveStudioTools( host ).find(
			( definition ) => definition.name === 'site_create'
		);
		expect( tool ).toBeDefined();

		const result = await executeTool( tool!, { name: 'My Site' } );

		expect( host.sites.create ).toHaveBeenCalledWith(
			'My Site',
			path.join( os.tmpdir(), 'my-site' ),
			expect.any( Function )
		);
		expect( ui.showArtifact ).toHaveBeenCalledWith(
			expect.objectContaining( {
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

		it( 'returns the tool unchanged without a UI', () => {
			const { tool } = makeFakeTool();
			expect( withChatArtifactEmission( tool, undefined ) ).toBe( tool );
		} );

		it( 'does not fail the tool result when artifact emission throws', async () => {
			const { tool } = makeFakeTool();
			const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
			const ui = withUi();
			ui.showArtifact.mockImplementation( () => {
				throw new Error( 'disk full' );
			} );

			try {
				const wrapped = withChatArtifactEmission( tool, ui );
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
				warnSpy.mockRestore();
			}
		} );

		it( 'emits site_create artifacts when wrapped directly (remote tool list)', async () => {
			const ui = withUi();
			const wrapped = withChatArtifactEmission( bindTool( createSiteTool, host ), ui );

			await executeTool( wrapped, { name: 'My Site' } );

			expect( ui.showArtifact ).toHaveBeenCalledWith(
				expect.objectContaining( {
					widgets: [
						expect.objectContaining( {
							type: 'site-preview',
							widgetProps: expect.objectContaining( { siteId: 'site-123' } ),
						} ),
					],
				} )
			);
		} );
	} );

	it( 'makes the created site the conversation site', async () => {
		const selectSite = vi.fn();
		host.selectSite = selectSite;

		await getTool( 'site_create' ).rawHandler( { name: 'My Site' } as never );

		expect( selectSite ).toHaveBeenCalledWith( {
			id: 'site-123',
			name: 'My Site',
			path: '/sites/my-site',
			running: true,
		} );
	} );

	it( 'lists previews as JSON for a resolved local site', async () => {
		const result = await getTool( 'preview_list' ).rawHandler( { nameOrPath: 'My Site' } as never );

		expect( host.previews.list ).toHaveBeenCalledWith( mockSite );
		expect( JSON.parse( getTextContent( result ) ?? 'null' ) ).toEqual( [] );
	} );

	it( 'reports a failed preview list as an error, not as no previews', async () => {
		vi.mocked( host.previews.list ).mockRejectedValue( new Error( 'Authentication required.' ) );

		await expect(
			getTool( 'preview_list' ).rawHandler( { nameOrPath: 'My Site' } as never )
		).rejects.toThrow( 'Failed to list preview sites: Authentication required.' );
	} );

	it( 'enrichPreviewListOutput tags each preview with type "preview" and an expiry flag', () => {
		const dayMs = 24 * 60 * 60 * 1000;
		const futureDate = Date.now() + 3 * dayMs;
		const enriched = JSON.parse(
			enrichPreviewListOutput( [
				{
					url: 'demo-studio.wp.build',
					atomicSiteId: 12345,
					localSiteId: 'site-123',
					date: futureDate,
					name: 'My Site',
				},
			] )
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
		const site = {
			id: 111,
			localSiteId: '',
			name: 'My Production Site',
			url: 'https://myprod.wordpress.com',
			isStaging: false,
			isPressable: false,
			environmentType: 'production',
			syncSupport: 'syncable' as const,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		vi.mocked( host.wpcom.connectedSites ).mockResolvedValue( [
			{ ...site, localSiteId: 'site-123', syncSupport: 'already-connected' },
		] );

		const result = await getTool( 'site_connected_remote_sites' ).rawHandler( {
			nameOrPath: 'My Site',
		} as never );

		expect( host.wpcom.connectedSites ).toHaveBeenCalledWith( mockSite );
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

	describe( 'site_list', () => {
		beforeEach( () => {
			vi.mocked( host.sites.list ).mockResolvedValue( [
				{ id: 'site-123', name: 'My Site', running: false },
			] as never );
		} );

		it( 'lists local and WordPress.com sites together', async () => {
			vi.mocked( host.wpcom.token ).mockResolvedValue( 'token' );
			vi.mocked( host.wpcom.sites ).mockResolvedValue( [
				{ id: 111, name: 'My Production Site', url: 'https://myprod.wordpress.com' },
			] );

			const result = await getTool( 'site_list' ).rawHandler( {} as never );

			expect( host.wpcom.sites ).toHaveBeenCalled();
			expect( JSON.parse( getTextContent( result )! ) ).toEqual( {
				local: [ { id: 'site-123', name: 'My Site', running: false } ],
				wordpressCom: {
					signedIn: true,
					sites: [ { id: 111, name: 'My Production Site', url: 'https://myprod.wordpress.com' } ],
				},
			} );
		} );

		it( 'says when the user is not logged in to WordPress.com', async () => {
			vi.mocked( host.wpcom.token ).mockResolvedValue( undefined );

			const result = await getTool( 'site_list' ).rawHandler( {} as never );

			expect( host.wpcom.sites ).not.toHaveBeenCalled();
			expect( JSON.parse( getTextContent( result )! ).wordpressCom ).toEqual( {
				signedIn: false,
				sites: [],
			} );
		} );

		it( 'keeps the local sites when WordPress.com cannot be reached', async () => {
			vi.mocked( host.wpcom.token ).mockResolvedValue( 'token' );
			vi.mocked( host.wpcom.sites ).mockRejectedValue( new Error( 'Failed to fetch' ) );

			const parsed = JSON.parse(
				getTextContent( await getTool( 'site_list' ).rawHandler( {} as never ) )!
			);

			expect( parsed.local ).toHaveLength( 1 );
			expect( parsed.wordpressCom ).toEqual( {
				signedIn: true,
				sites: [],
				error: 'Failed to fetch',
			} );
		} );
	} );

	it( 'updates previews with a normalized hostname', async () => {
		const result = await getTool( 'preview_update' ).rawHandler( {
			nameOrPath: 'My Site',
			host: 'https://demo.wordpress.com/',
			overwrite: true,
		} as never );

		expect( host.previews.update ).toHaveBeenCalledWith(
			mockSite,
			'demo.wordpress.com',
			true,
			expect.any( Function )
		);
		expect( getTextContent( result ) ).toBe(
			'Preview site "My Site Preview 1" updated from "My Site": https://demo.wp.build'
		);
	} );

	it( 'returns preview delete failures as tool errors', async () => {
		vi.mocked( host.previews.delete ).mockRejectedValue( new Error( 'Preview site not found.' ) );

		await expect(
			getTool( 'preview_delete' ).rawHandler( {
				host: 'https://demo.wordpress.com/',
			} as never )
		).rejects.toThrow( 'Failed to delete preview site: Preview site not found.' );

		expect( host.previews.delete ).toHaveBeenCalledWith(
			'demo.wordpress.com',
			expect.any( Function )
		);
	} );

	it.each( [
		[
			'shell syntax in post content',
			'post create --post_type=page --post_title=Home --post_content="$(cat /tmp/one-page-content.txt)"',
			/does not run in a shell/,
		],
		[
			'typographic dash options',
			'post create --post_type=page --post_title="About" --post_content="Hello world" –porcelain',
			/typographic dash/,
		],
	] )( 'wp_cli rejects %s before dispatching to WP-CLI', async ( _name, command, error ) => {
		await expect(
			getTool( 'wp_cli' ).rawHandler( { nameOrPath: 'My Site', command } as never )
		).rejects.toThrow( error );
		expect( host.sites.wpCli ).not.toHaveBeenCalled();
	} );

	it.each( [
		[
			'keeps unquoted post_content as one trailing literal argument',
			`post create --post_type=page --post_title="About" --post_status=publish --post_content=<!-- wp:paragraph -->
<p>Hello world</p>
<!-- /wp:paragraph -->`,
			[
				'post',
				'create',
				'--post_type=page',
				'--post_title=About',
				'--post_status=publish',
				'--post_content=<!-- wp:paragraph -->\n<p>Hello world</p>\n<!-- /wp:paragraph -->',
			],
		],
		[
			'strips matching outer quotes from trailing post_content',
			'post create --post_type=page --post_title="About" --post_content="Hello world"',
			[ 'post', 'create', '--post_type=page', '--post_title=About', '--post_content=Hello world' ],
		],
		[
			'keeps flags after quoted post_content out of the content',
			'post create --post_title="About" --post_content="Hello world" --porcelain',
			[ 'post', 'create', '--post_title=About', '--post_content=Hello world', '--porcelain' ],
		],
		[
			'keeps flags after empty quoted post_content out of the content',
			'post create --post_title="About" --post_content="" --porcelain',
			[ 'post', 'create', '--post_title=About', '--post_content=', '--porcelain' ],
		],
		[
			'reads backslash-escaped quotes inside double-quoted post_content',
			String.raw`post update 5 --post_content="{\"styles\":{\"color\":{\"background\":\"#1e2a44\"}}}" --porcelain`,
			[
				'post',
				'update',
				'5',
				'--post_content={"styles":{"color":{"background":"#1e2a44"}}}',
				'--porcelain',
			],
		],
		[
			'reads post_content when quotes wrap the whole argument',
			`post update 5 '--post_content={"styles":{"color":{"background":"#1e2a44"}}}' --porcelain`,
			[
				'post',
				'update',
				'5',
				'--post_content={"styles":{"color":{"background":"#1e2a44"}}}',
				'--porcelain',
			],
		],
	] )( 'splitCommandArgs %s', ( _name, command, expected ) => {
		expect( splitCommandArgs( command ) ).toEqual( expected );
	} );

	it( 'reserves media-library attachments, returns at once, and reports failures once the images are done', async () => {
		const sitePath = await mkdtemp( path.join( os.tmpdir(), 'studio-generate-images-' ) );
		const site = { ...mockSite, path: sitePath };
		const uploads = path.join( sitePath, 'wp-content', 'uploads' );
		const themeImage = path.join( sitePath, 'wp-content/themes/acme/assets/images/band.png' );
		const urlOf = ( name: string ) => `http://localhost:8888/wp-content/uploads/2026/09/${ name }`;
		vi.mocked( host.sites.all ).mockResolvedValue( [ mockSite, site ] );
		vi.mocked( host.wpcom.imageToken ).mockResolvedValue( 'token' );
		vi.mocked( generateImages ).mockResolvedValue( [
			{ ok: true, bytes: Buffer.from( 'jpeg' ) },
			{ ok: false, error: 'Timed out' },
			{ ok: true, bytes: Buffer.from( 'jpeg' ) },
		] );
		vi.mocked( host.sites.wpCli )
			.mockResolvedValueOnce( {
				exitCode: 0,
				stdout: JSON.stringify( [
					{ id: 7, file: 'wp-content/uploads/2026/09/hero.png', url: urlOf( 'hero.png' ) },
					{ id: 8, file: 'wp-content/uploads/2026/09/buns.png', url: urlOf( 'buns.png' ) },
				] ),
				stderr: '',
			} )
			.mockResolvedValueOnce( { exitCode: 0, stdout: '', stderr: '' } );

		try {
			const result = await getTool( 'generate_images' ).rawHandler( {
				images: [
					{ path: path.join( uploads, 'hero.png' ), subject: 'A café counter at dawn' },
					{ path: path.join( uploads, 'buns.png' ), subject: 'Cardamom buns on a tray' },
					{ path: themeImage, subject: 'Pebbles on a beach' },
				],
			} as never );

			expect( getTextContent( result ) ).toContain(
				`- ${ path.join( uploads, '2026', '09', 'hero.png' ) }, attachment ID 7, URL ${ urlOf(
					'hero.png'
				) }`
			);
			expect( await result.pending ).toContain(
				`FAILED ${ path.join( uploads, 'buns.png' ) }: Timed out`
			);
			await expect(
				readFile( path.join( uploads, '2026', '09', 'hero.png' ), 'utf8' )
			).resolves.toBe( 'jpeg' );
			await expect( readFile( themeImage, 'utf8' ) ).resolves.toBe( 'jpeg' );
			const finalize = vi.mocked( host.sites.wpCli ).mock.calls[ 1 ][ 1 ][ 1 ];
			expect(
				JSON.parse(
					Buffer.from( finalize.match( /base64_decode\( '([^']+)' \)/ )![ 1 ], 'base64' ).toString()
				)
			).toEqual( { ready: [ 7 ], failed: [ 8 ] } );
		} finally {
			await rm( sitePath, { recursive: true, force: true } );
		}
	} );

	describe( 'scaffold_theme', () => {
		let tempSiteRoot: string;
		let scaffoldSite: typeof mockSite;

		beforeEach( async () => {
			tempSiteRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-scaffold-theme-' ) );
			await mkdir( path.join( tempSiteRoot, 'wp-content', 'themes' ), { recursive: true } );
			scaffoldSite = { ...mockSite, path: tempSiteRoot };
			vi.mocked( host.sites.resolve ).mockResolvedValue( scaffoldSite );
			vi.mocked( host.sites.isRunning ).mockResolvedValue( false );
		} );

		afterEach( async () => {
			vi.unstubAllGlobals();
			await rm( tempSiteRoot, { recursive: true, force: true } );
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
			expect( styleCss ).toContain( '.wp-site-blocks main {' );
			expect( styleCss ).toContain( '.wp-site-blocks main.is-flush {' );

			const pageNoTitle = await readFile(
				path.join( themeDir, 'templates', 'page-no-title.html' ),
				'utf8'
			);
			expect( pageNoTitle ).toContain( '{"tagName":"main","className":"is-flush"}' );

			for ( const template of await readdir( path.join( themeDir, 'templates' ) ) ) {
				const markup = await readFile( path.join( themeDir, 'templates', template ), 'utf8' );
				expect( markup.match( /<!-- wp:template-part .*?-->/g ) ).toEqual( [
					'<!-- wp:template-part {"slug":"header","tagName":"header"} /-->',
					'<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->',
				] );
			}

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
			expect( getTextContent( result ) ).toContain(
				`<file path="${ path.join( 'templates', 'page-no-title.html' ) }">\n${ pageNoTitle }</file>`
			);
		} );

		const writeNunitoDesign = () =>
			writeFile(
				path.join( tempSiteRoot, 'DESIGN.md' ),
				'---\ncolors:\n  primary: "#e2231a"\ntypography:\n  body:\n    fontFamily: "Nunito, sans-serif"\n    fontWeight: 400\n  headline:\n    fontFamily: "Nunito, sans-serif"\n    fontWeight: 700\n---\n'
			);

		it( 'fills theme.json from DESIGN.md and downloads its fonts into the theme', async () => {
			await writeNunitoDesign();
			const face = ( subset: string, weight: number, file: string ) =>
				`/* ${ subset } */\n@font-face {\n  font-family: 'Nunito';\n  font-style: normal;\n  font-weight: ${ weight };\n  src: url(https://fonts.gstatic.com/${ file }.woff2) format('woff2');\n  unicode-range: U+${ subset };\n}\n`;
			const fetchMock = vi.fn( async ( url: string ) =>
				url.startsWith( 'https://fonts.googleapis.com/' )
					? new Response(
							[ 400, 700 ]
								.flatMap( ( weight ) => [
									face( 'latin-ext', weight, 'ext' ),
									face( 'latin', weight, 'latin' ),
								] )
								.join( '' )
					  )
					: new Response( new Uint8Array( [ 1, 2, 3 ] ) )
			);
			vi.stubGlobal( 'fetch', fetchMock );

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
				activate: false,
			} as never );

			const themeDir = path.join( tempSiteRoot, 'wp-content', 'themes', 'acme-studio' );
			const themeJson = JSON.parse( await readFile( path.join( themeDir, 'theme.json' ), 'utf8' ) );
			expect( themeJson.settings.color.palette ).toEqual( [
				{ slug: 'primary', color: '#e2231a', name: 'Primary' },
			] );
			expect( themeJson.settings.layout ).toEqual( { contentSize: '1000px', wideSize: '1280px' } );
			expect( fetchMock ).toHaveBeenCalledWith(
				'https://fonts.googleapis.com/css2?family=Nunito:wght@400;700&display=swap',
				expect.anything()
			);
			expect( themeJson.settings.typography.fontFamilies[ 0 ].fontFace ).toEqual(
				[ 'latin-ext', 'latin' ].map( ( subset ) => ( {
					fontFamily: 'Nunito',
					fontStyle: 'normal',
					fontWeight: '400 700',
					src: [ `file:./assets/fonts/nunito/nunito-400-700-${ subset }.woff2` ],
					unicodeRange: `U+${ subset }`,
				} ) )
			);
			await expect(
				readFile( path.join( themeDir, 'assets/fonts/nunito/nunito-400-700-latin.woff2' ) )
			).resolves.toEqual( Buffer.from( [ 1, 2, 3 ] ) );
			expect( getTextContent( result ) ).toContain(
				'theme.json carries the DESIGN.md tokens under the same names (1 color, 1 font family, 2 text styles, 0 spacing steps), with its fonts downloaded to assets/fonts and declared as fontFace.'
			);
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

		it( 'treats an empty parentTheme as no parent and scaffolds a blank theme', async () => {
			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
				parentTheme: '',
			} as never );

			expect( getTextContent( result ) ).not.toMatch( /Child theme/ );
			await expect(
				stat(
					path.join(
						tempSiteRoot,
						'wp-content',
						'themes',
						'acme-studio',
						'templates',
						'index.html'
					)
				)
			).resolves.toBeDefined();
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
			vi.mocked( host.sites.isRunning ).mockResolvedValue( true );
			vi.mocked( host.sites.wpCli ).mockResolvedValue( {
				exitCode: 0,
				stdout: "Success: Switched to 'Acme Studio' theme.",
				stderr: '',
			} );

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
			} as never );

			expect( host.sites.wpCli ).toHaveBeenCalledWith( scaffoldSite, [
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
			vi.mocked( host.sites.isRunning ).mockResolvedValue( true );

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
				activate: false,
			} as never );

			expect( host.sites.wpCli ).not.toHaveBeenCalled();
			expect( getTextContent( result ) ).toContain(
				'Activate with: wp theme activate acme-studio'
			);
		} );

		it( 'reports activation skipped when the site is not running', async () => {
			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
			} as never );

			expect( host.sites.wpCli ).not.toHaveBeenCalled();
			expect( getTextContent( result ) ).toContain( 'Activation skipped:' );
			expect( getTextContent( result ) ).toContain( 'Site is not running' );
			expect( getTextContent( result ) ).toContain(
				'Activate manually with: wp theme activate acme-studio'
			);
		} );

		it( 'reports activation failure when WP-CLI returns a non-zero exit code', async () => {
			vi.mocked( host.sites.isRunning ).mockResolvedValue( true );
			vi.mocked( host.sites.wpCli ).mockResolvedValue( {
				exitCode: 1,
				stdout: '',
				stderr: 'Error: stylesheet missing.',
			} );

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
