import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { runCommand } from '../wp';

vi.mock( '@studio/common/lib/site-runtime', () => ( {
	SITE_RUNTIME_NATIVE_PHP: 'native-php',
	getSiteRuntime: () => 'playground',
} ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( { getSiteByFolder: vi.fn() } ) );
vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', () => ( { runWpCliCommandWithMessaging: vi.fn() } ) );
vi.mock( 'cli/logger', () => ( {
	Logger: class {},
	LoggerError: class LoggerError extends Error {},
} ) );

describe( 'CLI: studio wp', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: 'site-id',
			path: '/site',
			phpVersion: '8.3',
		} as Awaited< ReturnType< typeof getSiteByFolder > > );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
	} );

	it( 'disposes the PHP-WASM command before waiting for its response streams to end', async () => {
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		const dispose = vi.fn( () => {
			stdout.end( 'complete output\n' );
			stderr.end();
		} );
		const stdoutSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );

		vi.mocked( runWpCliCommandWithMessaging ).mockResolvedValue( {
			response: { stdout, stderr, exitCode: Promise.resolve( 0 ) },
			[ Symbol.dispose ]: dispose,
		} as never );

		await runCommand( '/site', [ '--help' ] );

		expect( stdoutSpy ).toHaveBeenCalledWith( expect.any( Buffer ) );
		expect( dispose ).toHaveBeenCalledOnce();
		expect( disconnectFromDaemon ).toHaveBeenCalled();
		const disposeOrder = dispose.mock.invocationCallOrder[ 0 ];
		const outputOrder = stdoutSpy.mock.invocationCallOrder[ 0 ];
		expect( disposeOrder ).toBeLessThan( outputOrder );

		stdoutSpy.mockRestore();
	} );
} );
