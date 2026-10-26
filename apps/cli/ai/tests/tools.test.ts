import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import { vi } from 'vitest';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { setChatArtifactCallback } from 'cli/ai/chat-artifacts';
import { loadDesignCatalog } from 'cli/ai/design-catalog';
import { generateImages, isImageGenerationAvailable } from 'cli/ai/image-generation';
import { emitEvent } from 'cli/ai/json-events';
import { setScreenshotDirectoryProvider } from 'cli/ai/screenshot-storage';
import { setLocalSiteSelectedCallback } from 'cli/ai/site-selection';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { getWpComSites } from 'cli/lib/api';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import {
	captureCommandOutput,
	resolveStudioToolDefinitions,
	studioToolDefinitions,
	withChatArtifactEmission,
} from '../tools';
import { createSiteTool } from '../tools/create-site';
import {
	LOCAL_CHANGE,
	READ_ONLY,
	REMOTE_READ,
	type AnyStudioAgentTool,
} from '../tools/define-tool';
import { enrichPreviewListOutput } from '../tools/list-previews';
import { createTakeScreenshotTool } from '../tools/take-screenshot';

vi.mock( 'cli/ai/block-validator', () => ( {
	validateBlocks: vi.fn(),
} ) );

vi.mock( 'cli/ai/browser-utils', () => ( {
	getSharedBrowser: vi.fn(),
} ) );

vi.mock( 'cli/ai/json-events', () => ( {
	emitEvent: vi.fn(),
} ) );

vi.mock( 'cli/ai/image-generation', async () => ( {
	...( await vi.importActual( 'cli/ai/image-generation' ) ),
	generateImages: vi.fn(),
	isImageGenerationAvailable: vi.fn(),
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

vi.mock( 'cli/lib/api', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/api') >() ),
	getWpComSites: vi.fn(),
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
	runWpCliCommand: vi.fn(),
} ) );

vi.mock( 'cli/lib/site-paths', async () => ( {
	...( await vi.importActual( 'cli/lib/site-paths' ) ),
	STUDIO_SITES_ROOT: ( await import( 'os' ) ).tmpdir(),
} ) );

vi.mock( 'cli/lib/wordpress-server-manager', () => ( {
	isServerRunning: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/connected-sites', () => ( {
	getConnectedWpcomSitesForLocalSite: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/sync/sync-api', () => ( { fetchSyncableSites: vi.fn() } ) );

vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );

describe( 'Studio AI MCP tools', () => {
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
		scaledBuffer = buffer,
	}: {
		buffer: Buffer;
		documentHeight?: number;
		scaledBuffer?: Buffer;
	} ) => ( {
		emulateMedia: vi.fn(),
		goto: vi.fn(),
		waitForLoadState: vi.fn().mockResolvedValue( undefined ),
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
	beforeEach( () => {
		vi.resetAllMocks();
		process.exitCode = undefined;
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ mockSite ],
		} as Awaited< ReturnType< typeof readCliConfig > > );
		vi.mocked( getSiteByFolder ).mockResolvedValue( mockSite );
	} );

	afterEach( () => {
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
		{ host: {}, tool: 'wp_cli', appears: true },
		{ host: { shell: true }, tool: 'wp_cli', appears: false },
		{ host: {}, tool: 'generate_images', appears: false },
		{ host: { imageGeneration: true }, tool: 'generate_images', appears: true },
	] )( 'on host $host, $tool appears: $appears', ( { host, tool, appears } ) => {
		expect( resolveStudioToolDefinitions( host ).some( ( t ) => t.name === tool ) ).toBe( appears );
	} );

	it( 'pick_design offers options only when the user can be asked, and draws one otherwise', async () => {
		expect( getTool( 'pick_design' ).description ).not.toContain( 'options: 4' );
		expect(
			resolveStudioToolDefinitions( { canAskUser: true } ).find( ( t ) => t.name === 'pick_design' )
				?.description
		).toContain( 'options: 4' );
		const text =
			getTextContent(
				await executeTool( getTool( 'pick_design' ), { catalog: 'layouts', options: 4 } )
			) ?? '';
		expect( text ).not.toContain( 'Option 1' );
		expect( text ).toContain( 'cannot be asked in this session' );
	} );

	// Each draw says what follows it, so the design steps need no runbook.
	it.each( [
		{ canAskUser: false, catalog: 'layouts', options: 1, next: 'Next: write the theme.' },
		{ canAskUser: false, catalog: 'directions', options: 1, next: 'in this look' },
		{ canAskUser: true, catalog: 'directions', options: 4, next: 'Once picked, make the' },
		{ canAskUser: true, catalog: 'layouts', options: 4, next: 'Once picked, write the theme.' },
	] )(
		'pick_design says what follows a $catalog draw of $options',
		async ( { canAskUser, catalog, options, next } ) => {
			const tool = resolveStudioToolDefinitions( { canAskUser } ).find(
				( t ) => t.name === 'pick_design'
			)!;
			const chosen =
				catalog === 'directions'
					? loadDesignCatalog( 'directions' )
							.slice( 0, options )
							.map( ( { name } ) => ( { name, reason: 'Fits.' } ) )
					: undefined;
			expect( getTextContent( await executeTool( tool, { catalog, options, chosen } ) ) ).toContain(
				next
			);
		}
	);

	it( 'refuses to guess between sites that share a name', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ mockSite, { ...mockSite, id: 'site-456', path: '/other/my-site' } ],
		} as Awaited< ReturnType< typeof readCliConfig > > );

		await expect(
			getTool( 'site_delete' ).rawHandler( { nameOrPath: 'My Site' } as never )
		).rejects.toThrow( '/sites/my-site, /other/my-site' );
		expect( runDeleteSiteCommand ).not.toHaveBeenCalled();
	} );

	it( 'deletes a site with progress threaded to the tool logger', async () => {
		const result = await getTool( 'site_delete' ).rawHandler( {
			nameOrPath: 'My Site',
		} as never );

		expect( runDeleteSiteCommand ).toHaveBeenCalledWith(
			mockSite.path,
			true,
			expect.any( Logger )
		);
		expect( getTextContent( result ) ).toBe( 'Site "My Site" deleted.' );
	} );

	describe( 'take_screenshot', () => {
		let screenshotDirectory: string;

		beforeEach( async () => {
			screenshotDirectory = await mkdtemp( path.join( os.tmpdir(), 'studio-screenshots-' ) );
			setScreenshotDirectoryProvider( () => screenshotDirectory );
		} );

		afterEach( async () => {
			setScreenshotDirectoryProvider( null );
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

			const result = await createTakeScreenshotTool( { visionEnabled: false } ).rawHandler( {
				url: 'http://localhost:8903/',
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
			const resultWith = async (
				options: Parameters< typeof resolveStudioToolDefinitions >[ 0 ]
			) => {
				mockScreenshotBrowser(
					createMockPage( { buffer: Buffer.from( 'jpeg' ), documentHeight: 900 } )
				);
				const tool = resolveStudioToolDefinitions( options ).find(
					( definition ) => definition.name === 'take_screenshot'
				);
				const result = await tool!.rawHandler( { url: 'http://localhost:8903/' } as never );
				return result.content.find( ( block ) => block.type === 'text' )?.text ?? '';
			};
			expect( await resultWith( {} ) ).toContain( note );
			expect( await resultWith( { emitChatArtifacts: true } ) ).not.toContain( note );
			expect( await resultWith( { imageLink: ( file ) => file } ) ).not.toContain( note );
		} );
	} );

	it( 'creates previews for a resolved local site', async () => {
		const result = await getTool( 'preview_create' ).rawHandler( {
			nameOrPath: 'My Site',
		} as never );

		expect( runCreatePreviewCommand ).toHaveBeenCalledWith(
			'/sites/my-site',
			undefined,
			expect.any( Logger )
		);
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
			} ),
			expect.any( Logger )
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

	it.each( [
		{ signedIn: true, expected: { signedIn: true, targets: [ 'already-connected' ] } },
		{
			signedIn: false,
			expected: {
				signedIn: false,
				signIn: 'The user signs in to WordPress.com with /login.',
				targets: [],
			},
		},
	] )(
		'lists each built-in host with its connected targets (signed in: $signedIn)',
		async ( { signedIn, expected } ) => {
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
			vi.mocked( getConnectedWpcomSitesForLocalSite ).mockResolvedValue( [
				{ ...site, localSiteId: 'site-123', name: 'Name at connect time' },
			] );
			vi.mocked( readAuthToken ).mockResolvedValue(
				( signedIn ? { accessToken: 'token' } : null ) as never
			);
			vi.mocked( fetchSyncableSites ).mockResolvedValue( [ site ] );

			const result = await getTool( 'site_publish_targets' ).rawHandler( {
				nameOrPath: 'My Site',
			} as never );

			const [ wpcom, ...others ] = JSON.parse( getTextContent( result ) ?? '[]' );
			expect( others ).toEqual( [] );
			expect( {
				host: wpcom.host,
				name: wpcom.name,
				signedIn: wpcom.signedIn,
				signIn: wpcom.signIn,
				targets: wpcom.targets.map( ( t: { syncSupport: string } ) => t.syncSupport ),
			} ).toEqual( { host: 'wpcom', name: 'WordPress.com', signIn: undefined, ...expected } );
			expect( wpcom.publishes ).toContain( 'Pressable' );
			if ( signedIn ) {
				expect( getConnectedWpcomSitesForLocalSite ).toHaveBeenCalledWith( 'site-123' );
				expect( wpcom.targets[ 0 ] ).toMatchObject( {
					id: 111,
					name: 'My Production Site',
					url: 'https://myprod.wordpress.com',
				} );
			}
		}
	);

	describe( 'site_list', () => {
		beforeEach( () => {
			vi.mocked( runListSitesCommand ).mockImplementation( async () => {
				console.log( JSON.stringify( [ { id: 'site-123', name: 'My Site', running: false } ] ) );
			} );
		} );

		it( 'lists local and WordPress.com sites together', async () => {
			vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
			vi.mocked( getWpComSites ).mockResolvedValue( [
				{ id: 111, name: 'My Production Site', url: 'https://myprod.wordpress.com' },
			] );

			const result = await getTool( 'site_list' ).rawHandler( {} as never );

			expect( getWpComSites ).toHaveBeenCalledWith( 'token' );
			expect( JSON.parse( getTextContent( result )! ) ).toEqual( {
				local: [ { id: 'site-123', name: 'My Site', running: false } ],
				wordpressCom: {
					signedIn: true,
					sites: [ { id: 111, name: 'My Production Site', url: 'https://myprod.wordpress.com' } ],
				},
			} );
		} );

		it( 'says when the user is not logged in to WordPress.com', async () => {
			vi.mocked( readAuthToken ).mockResolvedValue( null );

			const result = await getTool( 'site_list' ).rawHandler( {} as never );

			expect( getWpComSites ).not.toHaveBeenCalled();
			expect( JSON.parse( getTextContent( result )! ).wordpressCom ).toEqual( {
				signedIn: false,
				sites: [],
			} );
		} );

		it( 'keeps the local sites when WordPress.com cannot be reached', async () => {
			vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
			vi.mocked( getWpComSites ).mockRejectedValue( new Error( 'Failed to fetch' ) );

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

		expect( runUpdatePreviewCommand ).toHaveBeenCalledWith(
			'/sites/my-site',
			'demo.wordpress.com',
			true,
			expect.any( Logger )
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
			'demo.wordpress.com',
			expect.any( Logger )
		);
	} );

	it( 'forwards command progress to the tool context', async () => {
		vi.mocked( runCreatePreviewCommand ).mockImplementation( async ( _path, _name, logger ) => {
			logger?.reportStart( 'validate' as never, 'Creating preview…' );
			logger?.reportSuccess( 'Almost done…' );
		} );

		const onProgress = vi.fn();
		await getTool( 'preview_create' ).rawHandler( { nameOrPath: 'My Site' } as never, {
			onProgress,
		} );

		expect( onProgress ).toHaveBeenCalledWith( 'Creating preview…', undefined );
		expect( onProgress ).toHaveBeenCalledWith( 'Almost done…', undefined );
	} );

	it( 'coalesces progress updates in captured command output', async () => {
		const onProgress = vi.fn();

		const result = await captureCommandOutput( async ( logger ) => {
			logger.reportStart( 'apply', 'Applying changes… (74%)' );
			logger.reportProgress( 'Applying changes… (75%)' );
			logger.reportProgress( 'Applying changes… (76%)' );
			logger.reportStart( 'done', 'Push complete' );
		}, onProgress );

		expect( result.progressOutput ).toBe( 'Applying changes… (76%)\nPush complete' );
		expect( onProgress ).toHaveBeenCalledWith( 'Applying changes… (75%)', true );
		expect( onProgress ).toHaveBeenCalledWith( 'Applying changes… (76%)', true );
	} );

	it( 'rejects shell syntax in wp_cli post content before dispatching to WP-CLI', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
		} );

		await expect(
			getTool( 'wp_cli' ).rawHandler( {
				nameOrPath: 'My Site',
				command:
					'post create --post_type=page --post_title=Home --post_content="$(cat /tmp/one-page-content.txt)"',
			} as never )
		).rejects.toThrow( /does not run in a shell/ );

		expect( runWpCliCommand ).not.toHaveBeenCalled();
	} );

	it( 'treats unquoted post_content as a single trailing literal argument', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
		} );
		vi.mocked( runWpCliCommand ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: `post create --post_type=page --post_title="About" --post_status=publish --post_content=<!-- wp:paragraph -->
<p>Hello world</p>
<!-- /wp:paragraph -->`,
		} as never );

		expect( runWpCliCommand ).toHaveBeenCalledWith( mockSite, [
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
		} );
		vi.mocked( runWpCliCommand ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: 'post create --post_type=page --post_title="About" --post_content="Hello world"',
		} as never );

		expect( runWpCliCommand ).toHaveBeenCalledWith( mockSite, [
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
		} );
		vi.mocked( runWpCliCommand ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command:
				'post create --post_type=page --post_title="About" --post_content="Hello world" --porcelain',
		} as never );

		expect( runWpCliCommand ).toHaveBeenCalledWith( mockSite, [
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--post_content=Hello world',
			'--porcelain',
		] );
	} );

	it.each( [
		[
			'reads backslash-escaped quotes inside double-quoted post_content',
			String.raw`post update 5 --post_content="{\"styles\":{\"color\":{\"background\":\"#1e2a44\"}}}" --porcelain`,
		],
		[
			'reads post_content when quotes wrap the whole argument',
			`post update 5 '--post_content={"styles":{"color":{"background":"#1e2a44"}}}' --porcelain`,
		],
	] )( '%s', async ( _name, command ) => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
		} );
		vi.mocked( runWpCliCommand ).mockResolvedValue( mockWpCliResponse( { stdout: '5' } ) as never );

		await getTool( 'wp_cli' ).rawHandler( { nameOrPath: 'My Site', command } as never );

		expect( runWpCliCommand ).toHaveBeenCalledWith( mockSite, [
			'post',
			'update',
			'5',
			'--post_content={"styles":{"color":{"background":"#1e2a44"}}}',
			'--porcelain',
		] );
	} );

	it( 'keeps porcelain after empty quoted post_content out of the page content', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
		} );
		vi.mocked( runWpCliCommand ).mockResolvedValue(
			mockWpCliResponse( { stdout: '123' } ) as never
		);

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: 'post create --post_type=page --post_title="About" --post_content="" --porcelain',
		} as never );

		expect( runWpCliCommand ).toHaveBeenCalledWith( mockSite, [
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--post_content=',
			'--porcelain',
		] );
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
			vi.mocked( runWpCliCommand ).mockResolvedValue(
				mockWpCliResponse( { stderr, exitCode: 1 } ) as never
			);
			const error = await getTool( 'wp_cli' )
				.rawHandler( { nameOrPath: 'My Site', command: 'db query "SELECT 1"' } as never )
				.catch( ( caught: Error ) => caught.message );
			expect( error ).toContain( stderr );
			expect( String( error ).includes( 'stores its database in SQLite' ) ).toBe( note );
		}
	);

	it( 'rejects typographic dash options before dispatching to WP-CLI', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
		} );

		await expect(
			getTool( 'wp_cli' ).rawHandler( {
				nameOrPath: 'My Site',
				command:
					'post create --post_type=page --post_title="About" --post_content="Hello world" –porcelain',
			} as never )
		).rejects.toThrow( /typographic dash/ );

		expect( runWpCliCommand ).not.toHaveBeenCalled();
	} );

	it( 'reserves media-library attachments, returns at once, and reports failures once the images are done', async () => {
		const sitePath = await mkdtemp( path.join( os.tmpdir(), 'studio-generate-images-' ) );
		const site = { ...mockSite, path: sitePath };
		const uploads = path.join( sitePath, 'wp-content', 'uploads' );
		const themeImage = path.join( sitePath, 'wp-content/themes/acme/assets/images/band.png' );
		const urlOf = ( name: string ) => `http://localhost:8888/wp-content/uploads/2026/09/${ name }`;
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ mockSite, site ],
		} as Awaited< ReturnType< typeof readCliConfig > > );
		vi.mocked( isImageGenerationAvailable ).mockResolvedValue( true );
		vi.mocked( generateImages ).mockResolvedValue( [
			{ ok: true, bytes: Buffer.from( 'jpeg' ) },
			{ ok: false, error: 'Timed out' },
			{ ok: true, bytes: Buffer.from( 'jpeg' ) },
		] );
		vi.mocked( runWpCliCommand )
			.mockResolvedValueOnce(
				mockWpCliResponse( {
					stdout: JSON.stringify( [
						{ id: 7, file: 'wp-content/uploads/2026/09/hero.png', url: urlOf( 'hero.png' ) },
						{ id: 8, file: 'wp-content/uploads/2026/09/buns.png', url: urlOf( 'buns.png' ) },
					] ),
				} ) as never
			)
			.mockResolvedValueOnce( mockWpCliResponse() as never );

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
			const finalize = vi.mocked( runWpCliCommand ).mock.calls[ 1 ][ 1 ][ 1 ];
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
