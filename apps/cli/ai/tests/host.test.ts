import { vi } from 'vitest';
import { captureCommandOutput } from 'cli/ai/command-output';
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
import { Logger } from 'cli/logger';

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

beforeEach( () => {
	vi.resetAllMocks();
	process.exitCode = undefined;
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

	it( 'returns what a command printed and the exit code it set', async () => {
		vi.mocked( runDeletePreviewCommand ).mockImplementation( async () => {
			process.exitCode = 1;
			console.log( 'Failed to delete preview site' );
		} );

		await expect( cliAgentHost.previews.delete( 'demo.wordpress.com', vi.fn() ) ).resolves.toEqual(
			{ consoleOutput: 'Failed to delete preview site', progressOutput: '', exitCode: 1 }
		);
		expect( process.exitCode ).toBeUndefined();
	} );

	it( 'forwards command progress', async () => {
		vi.mocked( runCreatePreviewCommand ).mockImplementation( async ( _path, _name, logger ) => {
			logger?.reportStart( 'validate' as never, 'Creating preview…' );
			logger?.reportSuccess( 'Almost done…' );
		} );
		const onProgress = vi.fn();

		await cliAgentHost.previews.create( hostSite, onProgress );

		expect( onProgress ).toHaveBeenCalledWith( 'Creating preview…', undefined );
		expect( onProgress ).toHaveBeenCalledWith( 'Almost done…', undefined );
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

describe( 'captureCommandOutput', () => {
	it( 'coalesces progress updates', async () => {
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
} );
