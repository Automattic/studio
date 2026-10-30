import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import { generateImages, isImageGenerationAvailable } from '@studio/agent/node/image-generation';
import {
	resolveStudioTools,
	studioToolDefinitions,
	withChatArtifactEmission,
	type StudioToolsOptions,
} from '@studio/agent/node/tools';
import { createSiteTool } from '@studio/agent/node/tools/create-site';
import {
	bindTool,
	LOCAL_CHANGE,
	READ_ONLY,
	REMOTE_READ,
	type AnyStudioAgentTool,
} from '@studio/agent/node/tools/define-tool';
import { enrichPreviewListOutput } from '@studio/agent/node/tools/list-previews';
import { createTakeScreenshotTool } from '@studio/agent/node/tools/take-screenshot';
import { splitCommandArgs } from '@studio/agent/node/wp-cli-args';
import { createFakeHost, fakeSite, fakeWpcom } from './fake-host';
import type { StudioAgentHost } from '@studio/agent/node/host';

vi.mock( '@studio/agent/node/block-validator', () => ( {
	validateBlocks: vi.fn(),
} ) );

vi.mock( '@studio/agent/node/browser-utils', () => ( {
	getSharedBrowser: vi.fn(),
} ) );

vi.mock( '@studio/agent/node/image-generation', async () => ( {
	...( await vi.importActual( '@studio/agent/node/image-generation' ) ),
	generateImages: vi.fn(),
	isImageGenerationAvailable: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );

describe( 'Studio AI MCP tools', () => {
	const mockSite = fakeSite;
	let host: StudioAgentHost;

	const getTool = ( name: string ) => {
		const tool = studioToolDefinitions.find( ( definition ) => definition.name === name );
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
		url: () => 'http://localhost:8903/',
		goto: vi.fn(),
		on: vi.fn(),
		// The page layout's script takes its region limit and returns lines.
		evaluate: vi.fn( async ( _script: unknown, args?: number | { source?: string } ) => {
			if ( typeof args === 'number' ) {
				return [ 'main: y 0–900 (900px tall), x 0–1040' ];
			}
			return args?.source ? scaledBuffer.toString( 'base64' ) : documentHeight;
		} ),
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
	beforeEach( () => {
		vi.resetAllMocks();
		host = createFakeHost( os.tmpdir() );
	} );

	it( 'marks only reads and non-destructive local changes as safe to run without asking', () => {
		const annotations = Object.fromEntries(
			studioToolDefinitions.map( ( tool ) => [ tool.name, tool.annotations ] )
		);
		expect( annotations.site_list ).toEqual( REMOTE_READ );
		expect( annotations.site_info ).toEqual( READ_ONLY );
		expect( annotations.site_create ).toEqual( LOCAL_CHANGE );
		for ( const name of [ 'site_delete', 'site_push', 'site_pull', 'wp_cli' ] ) {
			const { readOnlyHint, destructiveHint, openWorldHint } = annotations[ name ];
			expect( readOnlyHint || ( ! destructiveHint && ! openWorldHint ) ).toBe( false );
		}
	} );

	it.each( [
		{ options: {}, tool: 'wp_cli', appears: true },
		{ options: { shell: true }, tool: 'wp_cli', appears: false },
		{ options: {}, tool: 'generate_images', appears: false },
		{ options: { imageGeneration: true }, tool: 'generate_images', appears: true },
	] )( 'with options $options, $tool appears: $appears', ( { options, tool, appears } ) => {
		expect( resolveStudioTools( host, options ).some( ( t ) => t.name === tool ) ).toBe( appears );
	} );

	describe( 'take_screenshot', () => {
		let screenshotDirectory: string;

		beforeEach( async () => {
			screenshotDirectory = await mkdtemp( path.join( os.tmpdir(), 'studio-screenshots-' ) );
			host.screenshotsDirectory = () => screenshotDirectory;
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
				fullPage: true,
				display: true,
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
				viewport: 'desktop',
				display: false,
			} as never );

			expect( result.content.map( ( block ) => block.type ) ).toEqual( [ 'text' ] );
			expect( result.content[ 0 ] ).toMatchObject( {
				text: expect.stringContaining( '\n  main: y 0–900 (900px tall), x 0–1040\n' ),
			} );
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
					viewport: 'desktop',
					display,
				} as never );
				return result.content.find( ( block ) => block.type === 'text' )?.text ?? '';
			};
			const imageLink = ( file: string ) => `file://${ file }`;
			expect( await resultWith( {} ) ).toContain( note );
			withUi();
			expect( await resultWith( {} ) ).not.toContain( note );
			host.ui = undefined;
			const linked = await resultWith( { imageLink }, true );
			expect( linked ).not.toContain( note );
			expect( linked ).toContain(
				`![Screenshot (desktop)](file://${ screenshotDirectory }${ path.sep }`
			);
			expect( await resultWith( { imageLink }, false ) ).not.toContain( '![' );
		} );
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

	it( 'lists each remote host with its connected targets, and how to sign in when signed out', async () => {
		const wpcom = fakeWpcom();
		const signedOut = { ...fakeWpcom(), name: 'Other' };
		vi.mocked( wpcom.targets ).mockResolvedValue( {
			signedIn: true,
			targets: [ { id: 111, name: 'Prod', url: 'https://prod.example' } ],
		} as never );
		vi.mocked( signedOut.targets ).mockResolvedValue( { signedIn: false, targets: [] } );
		host.remoteHosts = { wpcom, other: signedOut };

		const result = await getTool( 'site_publish_targets' ).rawHandler( {
			nameOrPath: 'My Site',
		} as never );

		expect( wpcom.targets ).toHaveBeenCalledWith( mockSite );
		expect( JSON.parse( getTextContent( result ) ?? '[]' ) ).toEqual( [
			{
				host: 'wpcom',
				name: 'WordPress.com',
				publishes: wpcom.publishes,
				signedIn: true,
				targets: [ { id: 111, name: 'Prod', url: 'https://prod.example' } ],
			},
			{
				host: 'other',
				name: 'Other',
				publishes: signedOut.publishes,
				signedIn: false,
				signIn: signedOut.signIn,
				targets: [],
			},
		] );
	} );

	it( "lists local sites with each remote host's sites under its key", async () => {
		const wpcom = fakeWpcom();
		const listing = { signedIn: true, sites: [ { id: 111, name: 'Prod', url: 'https://p' } ] };
		vi.mocked( wpcom.sites!.list ).mockResolvedValue( listing );
		host.remoteHosts = { wpcom };
		vi.mocked( host.sites.list ).mockResolvedValue( [
			{ id: 'site-123', name: 'My Site', running: false },
		] as never );

		const result = await getTool( 'site_list' ).rawHandler( {} as never );

		expect( JSON.parse( getTextContent( result )! ) ).toEqual( {
			local: [ { id: 'site-123', name: 'My Site', running: false } ],
			wordpressCom: listing,
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

	// A MySQL client's access denied, as `db query` gets on a Studio site, which keeps its data in SQLite.
	it.each( [
		{
			stderr:
				"ERROR 1045 (28000): Access denied for user 'username_here'@'localhost' (using password: YES)",
			note: true,
		},
		{
			stderr:
				"mysqldump: Got error: 1045: Access denied for user 'username_here'@'localhost' (using password: YES) when trying to connect",
			note: true,
		},
		{ stderr: 'Error: Could not find the post with ID 1045.', note: false },
	] )(
		'says where a Studio site keeps its data when WP-CLI fails with $stderr',
		async ( { stderr, note } ) => {
			vi.mocked( host.sites.wpCli ).mockResolvedValue( { stdout: '', stderr, exitCode: 1 } );
			const error = await getTool( 'wp_cli' )
				.rawHandler( { nameOrPath: 'My Site', command: 'db query "SELECT 1"' } as never )
				.catch( ( caught: Error ) => caught.message );
			expect( error ).toContain( stderr );
			expect( String( error ).includes( 'stores its database in SQLite' ) ).toBe( note );
		}
	);

	it( 'reserves media-library attachments, returns at once, and reports failures once the images are done', async () => {
		const sitePath = await mkdtemp( path.join( os.tmpdir(), 'studio-generate-images-' ) );
		const site = { ...mockSite, path: sitePath };
		const uploads = path.join( sitePath, 'wp-content', 'uploads' );
		const themeImage = path.join( sitePath, 'wp-content/themes/acme/assets/images/band.png' );
		const urlOf = ( name: string ) => `http://localhost:8888/wp-content/uploads/2026/09/${ name }`;
		vi.mocked( host.sites.all ).mockResolvedValue( [ mockSite, site ] );
		vi.mocked( isImageGenerationAvailable ).mockResolvedValue( true );
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
} );
