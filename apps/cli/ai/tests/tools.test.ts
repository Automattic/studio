import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { emitEvent } from 'cli/ai/json-events';
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
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { getProgressCallback, setProgressCallback } from 'cli/logger';
import {
	captureCommandOutput,
	resolveStudioToolDefinitions,
	studioToolDefinitions,
} from '../tools';

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

vi.mock( 'cli/lib/wordpress-server-manager', () => ( {
	isServerRunning: vi.fn(),
	sendWpCliCommand: vi.fn(),
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
		expect( studioPresent?.description ).toContain( '- saved-local-media:' );
		expect( studioPresent?.description ).toContain(
			'For generated SVGs, write a complete .svg file'
		);
		expect( studioPresent?.description ).not.toContain( '- drawing:' );
	} );

	it( 'guides screenshots toward captured media widgets instead of site previews', () => {
		const takeScreenshot = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( tool ) => tool.name === 'take_screenshot' );
		const studioPresent = resolveStudioToolDefinitions( {
			emitChatArtifacts: true,
		} ).find( ( tool ) => tool.name === 'studio_present' );
		expect( takeScreenshot?.description ).toContain( 'actual captured PNG' );
		expect( takeScreenshot?.description ).toContain(
			'Do not use a site-preview widget as a substitute for the screenshot'
		);
		expect( studioPresent?.description ).toContain(
			'Do not substitute a site-preview widget for a screenshot'
		);
	} );

	it( 'keeps take_screenshot output compact while returning a media payload', async () => {
		const screenshotBuffer = Buffer.from( 'fake-png' );
		const page = {
			emulateMedia: vi.fn(),
			goto: vi.fn(),
			waitForLoadState: vi.fn().mockResolvedValue( undefined ),
			evaluate: vi.fn(),
			addStyleTag: vi.fn(),
			screenshot: vi.fn().mockResolvedValue( screenshotBuffer ),
			close: vi.fn(),
		};
		const browser = {
			newPage: vi.fn().mockResolvedValue( page ),
		};
		vi.mocked( getSharedBrowser ).mockResolvedValue( browser as never );

		const result = await getTool( 'take_screenshot' ).rawHandler( {
			url: 'http://localhost:8903/story-time',
		} as never );
		const text = getTextContent( result );
		expect( text ).toContain( 'Screenshot captured (desktop).' );
		expect( text ).toContain( 'mediaWidgetPayload=' );
		expect( text ).not.toContain( 'When this screenshot is useful to show the user' );
		expect( text ).not.toContain( 'Path:' );
		expect( text ).not.toContain( 'File URL:' );
		expect( result.content[ 1 ] ).toEqual( {
			type: 'image',
			data: screenshotBuffer.toString( 'base64' ),
			mimeType: 'image/png',
		} );

		const payload = JSON.parse( text!.split( 'mediaWidgetPayload=' )[ 1 ] ) as {
			widgetProps: { source: { path: string } };
		};
		await rm( path.dirname( payload.widgetProps.source.path ), { recursive: true, force: true } );
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
					widgets: [ { type: 'site-preview', widgetProps: { path: '/' } } ],
				} ),
			} )
		);
		expect( getTextContent( result ) ).toContain( '"name": "My Site"' );
	} );

	it( 'lists previews as JSON for a resolved local site', async () => {
		vi.mocked( runListPreviewCommand ).mockImplementation( async () => {
			console.log( '[{"url":"https://demo.wordpress.com"}]' );
		} );

		const result = await getTool( 'preview_list' ).rawHandler( { nameOrPath: 'My Site' } as never );

		expect( runListPreviewCommand ).toHaveBeenCalledWith( '/sites/my-site', 'json' );
		expect( getTextContent( result ) ).toBe( '[{"url":"https://demo.wordpress.com"}]' );
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
		} );

		await expect(
			getTool( 'wp_cli' ).rawHandler( {
				nameOrPath: 'My Site',
				command:
					'post create --post_type=page --post_title=Home --post_content="$(cat /tmp/one-page-content.txt)"',
			} as never )
		).rejects.toThrow( /does not run in a shell/ );

		expect( sendWpCliCommand ).not.toHaveBeenCalled();
	} );

	it( 'treats unquoted post_content as a single trailing literal argument', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
		} );
		vi.mocked( sendWpCliCommand ).mockResolvedValue( {
			stdout: '123',
			stderr: '',
			exitCode: 0,
		} );

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: `post create --post_type=page --post_title="About" --post_status=publish --post_content=<!-- wp:paragraph -->
<p>Hello world</p>
<!-- /wp:paragraph -->`,
		} as never );

		expect( sendWpCliCommand ).toHaveBeenCalledWith( 'site-123', [
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
		vi.mocked( sendWpCliCommand ).mockResolvedValue( {
			stdout: '123',
			stderr: '',
			exitCode: 0,
		} );

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: 'post create --post_type=page --post_title="About" --post_content="Hello world"',
		} as never );

		expect( sendWpCliCommand ).toHaveBeenCalledWith( 'site-123', [
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
		vi.mocked( sendWpCliCommand ).mockResolvedValue( {
			stdout: '123',
			stderr: '',
			exitCode: 0,
		} );

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command:
				'post create --post_type=page --post_title="About" --post_content="Hello world" --porcelain',
		} as never );

		expect( sendWpCliCommand ).toHaveBeenCalledWith( 'site-123', [
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
		} );
		vi.mocked( sendWpCliCommand ).mockResolvedValue( {
			stdout: '123',
			stderr: '',
			exitCode: 0,
		} );

		await getTool( 'wp_cli' ).rawHandler( {
			nameOrPath: 'My Site',
			command: 'post create --post_type=page --post_title="About" --post_content="" --porcelain',
		} as never );

		expect( sendWpCliCommand ).toHaveBeenCalledWith( 'site-123', [
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
		} );
		vi.mocked( sendWpCliCommand ).mockResolvedValue( {
			stdout: '123',
			stderr: '',
			exitCode: 0,
		} );
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
		} );
		vi.mocked( sendWpCliCommand ).mockResolvedValue( {
			stdout: '123',
			stderr: '',
			exitCode: 0,
		} );
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
		} );

		await expect(
			getTool( 'wp_cli' ).rawHandler( {
				nameOrPath: 'My Site',
				command:
					'post create --post_type=page --post_title="About" --post_content="Hello world" –porcelain',
			} as never )
		).rejects.toThrow( /typographic dash/ );

		expect( sendWpCliCommand ).not.toHaveBeenCalled();
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
			} );
			vi.mocked( sendWpCliCommand ).mockResolvedValue( {
				stdout: "Success: Switched to 'Acme Studio' theme.",
				stderr: '',
				exitCode: 0,
			} );

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
			} as never );

			expect( sendWpCliCommand ).toHaveBeenCalledWith( scaffoldSite.id, [
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
			} );

			const result = await getTool( 'scaffold_theme' ).rawHandler( {
				nameOrPath: scaffoldSite.name,
				name: 'Acme Studio',
				activate: false,
			} as never );

			expect( sendWpCliCommand ).not.toHaveBeenCalled();
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

			expect( sendWpCliCommand ).not.toHaveBeenCalled();
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
			} );
			vi.mocked( sendWpCliCommand ).mockResolvedValue( {
				stdout: '',
				stderr: 'Error: stylesheet missing.',
				exitCode: 1,
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
	} );
} );
