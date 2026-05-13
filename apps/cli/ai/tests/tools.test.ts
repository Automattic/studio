import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { vi } from 'vitest';
import { emitEvent } from 'cli/ai/json-events';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
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
				'preview_navigate',
				'preview_reload',
			] )
		);
	} );

	it( 'emits a preview navigate command with a normalized path', async () => {
		const result = await getTool( 'preview_navigate' ).rawHandler( { path: 'about/' } as never );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'preview.command',
				kind: 'navigate',
				path: '/about/',
			} )
		);
		expect( getTextContent( result ) ).toContain( '/about/' );
	} );

	it( 'falls back to "/" when preview_navigate receives an empty path', async () => {
		await getTool( 'preview_navigate' ).rawHandler( { path: '   ' } as never );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( { kind: 'navigate', path: '/' } )
		);
	} );

	it( 'emits a preview reload command', async () => {
		await getTool( 'preview_reload' ).rawHandler( {} as never );

		expect( emitEvent ).toHaveBeenCalledWith(
			expect.objectContaining( { type: 'preview.command', kind: 'reload' } )
		);
	} );

	it( 'omits preview-steering tools when preview steering is disabled', () => {
		const names = resolveStudioToolDefinitions().map( ( tool ) => tool.name );
		expect( names ).not.toContain( 'preview_navigate' );
		expect( names ).not.toContain( 'preview_reload' );
		// Baseline Studio tools still present.
		expect( names ).toContain( 'site_create' );
		expect( names ).toContain( 'wp_cli' );
	} );

	it( 'includes preview-steering tools when enabled', () => {
		const names = resolveStudioToolDefinitions( { enablePreviewSteering: true } ).map(
			( tool ) => tool.name
		);
		expect( names ).toContain( 'preview_navigate' );
		expect( names ).toContain( 'preview_reload' );
	} );

	describe( 'share_screenshot gating', () => {
		it( 'omits share_screenshot when remoteSession is not set', () => {
			const names = resolveStudioToolDefinitions( { enablePreviewSteering: true } ).map(
				( tool ) => tool.name
			);
			expect( names ).not.toContain( 'share_screenshot' );
			expect( names ).toContain( 'take_screenshot' );
		} );

		it( 'omits share_screenshot when remoteSession is false', () => {
			const names = resolveStudioToolDefinitions( {
				enablePreviewSteering: true,
				remoteSession: false,
			} ).map( ( tool ) => tool.name );
			expect( names ).not.toContain( 'share_screenshot' );
		} );

		it( 'includes share_screenshot when remoteSession is true', () => {
			const names = resolveStudioToolDefinitions( {
				enablePreviewSteering: true,
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
			runtime: SITE_RUNTIME_PLAYGROUND,
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
			runtime: SITE_RUNTIME_PLAYGROUND,
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
			runtime: SITE_RUNTIME_PLAYGROUND,
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
			runtime: SITE_RUNTIME_PLAYGROUND,
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
			runtime: SITE_RUNTIME_PLAYGROUND,
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
				runtime: SITE_RUNTIME_PLAYGROUND,
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
				runtime: SITE_RUNTIME_PLAYGROUND,
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
				runtime: SITE_RUNTIME_PLAYGROUND,
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
