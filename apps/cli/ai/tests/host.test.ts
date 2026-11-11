import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { cliAgentHost } from 'cli/ai/host';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { Logger } from 'cli/logger';

vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/snapshots', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/snapshots') >() ),
	getSnapshotsFromConfig: vi.fn(),
} ) );
vi.mock( 'cli/commands/preview/create', () => ( { runCommand: vi.fn() } ) );
vi.mock( import( 'cli/commands/preview/delete' ), async ( importActual ) => ( {
	Mode: ( await importActual() ).Mode,
	runCommand: vi.fn(),
} ) );
vi.mock( 'cli/commands/preview/update', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/site/create', () => ( { runCommand: vi.fn() } ) );
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
vi.mock( 'cli/lib/run-wp-cli-command', () => ( { runWpCliCommand: vi.fn() } ) );

const site = {
	id: 'site-123',
	name: 'My Site',
	path: '/sites/my-site',
	adminPassword: 'password',
	port: 8888,
	phpVersion: '8.4',
};
const hostSite = {
	id: 'site-123',
	name: 'My Site',
	path: '/sites/my-site',
	url: 'http://localhost:8888',
	phpVersion: '8.4',
	adminPassword: 'password',
};
const preview = {
	url: 'demo.wp.build',
	atomicSiteId: 12345,
	localSiteId: 'site-123',
	date: 0,
	name: 'My Site Preview 1',
};

beforeEach( () => {
	vi.resetAllMocks();
	vi.mocked( readCliConfig ).mockResolvedValue( {
		sites: [ site ],
	} as Awaited< ReturnType< typeof readCliConfig > > );
	vi.mocked( getSiteByFolder ).mockResolvedValue( site );
} );

describe( 'cliAgentHost', () => {
	it( 'resolves a site by name with its URL', async () => {
		await expect( cliAgentHost.sites.resolve( 'my site' ) ).resolves.toEqual( hostSite );
	} );

	it( 'refuses to guess between sites that share a name', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ site, { ...site, id: 'site-456', path: '/other/my-site' } ],
		} as Awaited< ReturnType< typeof readCliConfig > > );

		await expect( cliAgentHost.sites.resolve( 'My Site' ) ).rejects.toThrow(
			'/sites/my-site, /other/my-site'
		);
	} );

	it( 'creates a started site on the latest WordPress without opening a browser', async () => {
		await cliAgentHost.sites.create( 'My Site', '/sites/my-site', vi.fn() );

		expect( runCreateSiteCommand ).toHaveBeenCalledWith(
			'/sites/my-site',
			expect.objectContaining( {
				name: 'My Site',
				wpVersion: 'latest',
				noStart: false,
				skipBrowser: true,
			} ),
			expect.any( Logger )
		);
	} );

	it( 'runs the preview commands with the hostname and the site folder', async () => {
		await cliAgentHost.previews.update( hostSite, 'demo.wordpress.com', true, vi.fn() );
		await cliAgentHost.previews.delete( 'demo.wordpress.com', vi.fn() );

		expect( runUpdatePreviewCommand ).toHaveBeenCalledWith(
			'/sites/my-site',
			'demo.wordpress.com',
			true,
			expect.any( Logger )
		);
		expect( runDeletePreviewCommand ).toHaveBeenCalledWith(
			PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT,
			'demo.wordpress.com',
			expect.any( Logger )
		);
	} );

	it( 'returns the preview a command saved, and forwards its progress', async () => {
		vi.mocked( runCreatePreviewCommand ).mockImplementation( async ( _path, _name, logger ) => {
			logger?.reportStart( 'validate' as never, 'Creating preview…' );
			logger?.reportProgress( 'Uploading… (40%)' );
			return preview;
		} );
		const onProgress = vi.fn();

		await expect( cliAgentHost.previews.create( hostSite, onProgress ) ).resolves.toBe( preview );
		expect( onProgress ).toHaveBeenCalledWith( 'Creating preview…' );
		expect( onProgress ).toHaveBeenCalledWith( 'Uploading… (40%)', true );
	} );

	it( "lists the site's own previews, and refuses without a WordPress.com login", async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( { id: 7 } as never );
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ preview ] );

		await expect( cliAgentHost.previews.list( hostSite ) ).resolves.toEqual( [ preview ] );
		expect( getSnapshotsFromConfig ).toHaveBeenCalledWith( 7, '/sites/my-site' );

		vi.mocked( readAuthToken ).mockResolvedValue( null );
		await expect( cliAgentHost.previews.list( hostSite ) ).rejects.toThrow(
			'Authentication required'
		);
	} );

	it( 'runs WP-CLI through the daemon and returns its output', async () => {
		vi.mocked( runWpCliCommand ).mockResolvedValue( {
			response: {
				exitCode: Promise.resolve( 1 ),
				stdoutText: Promise.resolve( 'out' ),
				stderrText: Promise.resolve( 'err' ),
			},
			[ Symbol.asyncDispose ]: async () => {},
		} as never );

		await expect( cliAgentHost.sites.wpCli( hostSite, [ 'option', 'get' ] ) ).resolves.toEqual( {
			exitCode: 1,
			stdout: 'out',
			stderr: 'err',
		} );
		expect( runWpCliCommand ).toHaveBeenCalledWith( site, [ 'option', 'get' ] );
		expect( connectToDaemon ).toHaveBeenCalled();
		expect( disconnectFromDaemon ).toHaveBeenCalled();
	} );
} );
