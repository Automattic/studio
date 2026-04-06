import { vi } from 'vitest';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { bumpStat } from 'cli/lib/bump-stat';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { getProgressCallback, setProgressCallback } from 'cli/logger';
import { createStudioToolDefinitions, studioToolDefinitions } from '../tools';

vi.mock( 'cli/ai/block-validator', () => ( {
	validateBlocks: vi.fn(),
} ) );

vi.mock( 'cli/ai/browser-utils', () => ( {
	getSharedBrowser: vi.fn(),
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

vi.mock( 'cli/lib/bump-stat', () => ( {
	bumpStat: vi.fn(),
	bumpAggregatedUniqueStat: vi.fn(),
	getPlatformMetric: vi.fn(),
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
		phpVersion: '8.3',
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
				'record_workflow_event',
			] )
		);
	} );

	it( 'records workflow telemetry for a configured plugin group', async () => {
		const tool = createStudioToolDefinitions( 'codex-plugin' ).find(
			( definition ) => definition.name === 'record_workflow_event'
		);
		expect( tool ).toBeDefined();

		const result = await tool!.handler(
			{ workflow: 'theme-build', stage: 'started' } as never,
			null
		);

		expect( bumpStat ).toHaveBeenCalledWith( 'codex-plugin', 'theme-build-started' );
		expect( getTextContent( result ) ).toContain( 'codex-plugin theme-build-started' );
	} );

	it( 'skips workflow telemetry when no plugin group is configured', async () => {
		const result = await getTool( 'record_workflow_event' ).handler(
			{ workflow: 'theme-build', stage: 'started' } as never,
			null
		);

		expect( bumpStat ).not.toHaveBeenCalled();
		expect( result.isError ).toBeUndefined();
		expect( getTextContent( result ) ).toContain( 'no plugin group configured' );
	} );

	it( 'creates previews for a resolved local site', async () => {
		const result = await getTool( 'preview_create' ).handler(
			{ nameOrPath: 'My Site' } as never,
			null
		);

		expect( runCreatePreviewCommand ).toHaveBeenCalledWith( '/sites/my-site' );
		expect( result.isError ).toBeUndefined();
		expect( getTextContent( result ) ).toContain( 'Preview site created for "My Site".' );
	} );

	it( 'lists previews as JSON for a resolved local site', async () => {
		vi.mocked( runListPreviewCommand ).mockImplementation( async () => {
			console.log( '[{"url":"https://demo.wordpress.com"}]' );
		} );

		const result = await getTool( 'preview_list' ).handler(
			{ nameOrPath: 'My Site' } as never,
			null
		);

		expect( runListPreviewCommand ).toHaveBeenCalledWith( '/sites/my-site', 'json' );
		expect( result.isError ).toBeUndefined();
		expect( getTextContent( result ) ).toBe( '[{"url":"https://demo.wordpress.com"}]' );
	} );

	it( 'updates previews with a normalized hostname', async () => {
		const result = await getTool( 'preview_update' ).handler(
			{
				nameOrPath: 'My Site',
				host: 'https://demo.wordpress.com/',
				overwrite: true,
			} as never,
			null
		);

		expect( runUpdatePreviewCommand ).toHaveBeenCalledWith(
			'/sites/my-site',
			'demo.wordpress.com',
			true
		);
		expect( result.isError ).toBeUndefined();
		expect( getTextContent( result ) ).toContain(
			'Preview site "demo.wordpress.com" updated from "My Site".'
		);
	} );

	it( 'returns preview delete failures as tool errors', async () => {
		vi.mocked( runDeletePreviewCommand ).mockImplementation( async () => {
			process.exitCode = 1;
			console.log( 'Failed to delete preview site' );
		} );

		const result = await getTool( 'preview_delete' ).handler(
			{ host: 'https://demo.wordpress.com/' } as never,
			null
		);

		expect( runDeletePreviewCommand ).toHaveBeenCalledWith(
			PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT,
			'demo.wordpress.com'
		);
		expect( result.isError ).toBe( true );
		expect( getTextContent( result ) ).toBe( 'Failed to delete preview site' );
	} );

	it( 'restores the previous progress callback after running a preview tool', async () => {
		const previousCallback = vi.fn();
		setProgressCallback( previousCallback );

		await getTool( 'preview_create' ).handler( { nameOrPath: 'My Site' } as never, null );

		expect( getProgressCallback() ).toBe( previousCallback );
	} );

	it( 'rejects shell syntax in wp_cli post content before dispatching to WP-CLI', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( {
			name: 'site-123',
			pmId: 1,
			status: 'online',
			pid: 1234,
		} );

		const result = await getTool( 'wp_cli' ).handler(
			{
				nameOrPath: 'My Site',
				command:
					'post create --post_type=page --post_title=Home --post_content="$(cat /tmp/one-page-content.txt)"',
			} as never,
			null
		);

		expect( sendWpCliCommand ).not.toHaveBeenCalled();
		expect( result.isError ).toBe( true );
		expect( getTextContent( result ) ).toContain( 'does not run in a shell' );
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

		await getTool( 'wp_cli' ).handler(
			{
				nameOrPath: 'My Site',
				command: `post create --post_type=page --post_title="About" --post_status=publish --post_content=<!-- wp:paragraph -->
<p>Hello world</p>
<!-- /wp:paragraph -->`,
			} as never,
			null
		);

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

		await getTool( 'wp_cli' ).handler(
			{
				nameOrPath: 'My Site',
				command: 'post create --post_type=page --post_title="About" --post_content="Hello world"',
			} as never,
			null
		);

		expect( sendWpCliCommand ).toHaveBeenCalledWith( 'site-123', [
			'post',
			'create',
			'--post_type=page',
			'--post_title=About',
			'--post_content=Hello world',
		] );
	} );
} );
