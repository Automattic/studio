import { afterEach, expect, it, vi } from 'vitest';
import { commandHandler } from 'cli/commands/update';
import { reportCommandFailure } from 'cli/lib/error-reporting';
import { CliUpdateInProgressError, updateStandaloneCli } from 'cli/lib/standalone-updates';
import { Logger } from 'cli/logger';

vi.mock( 'cli/lib/update-notifier', async ( original ) => ( {
	...( await original< typeof import('cli/lib/update-notifier') >() ),
	getCliInstallKind: () => 'standalone',
} ) );
vi.mock( 'cli/lib/standalone-updates', async ( original ) => ( {
	...( await original< typeof import('cli/lib/standalone-updates') >() ),
	updateStandaloneCli: vi.fn(),
} ) );
vi.mock( 'cli/lib/error-reporting', () => ( { reportCommandFailure: vi.fn() } ) );

afterEach( () => {
	process.exitCode = 0;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

it( 'explains that another update is in progress without reporting a failure', async () => {
	vi.stubGlobal( '__STUDIO_CLI_VERSION__', '1.0.0' );
	vi.spyOn( console, 'log' ).mockImplementation( () => {} );
	const report = vi.spyOn( Logger.prototype, 'reportError' );
	vi.mocked( updateStandaloneCli ).mockRejectedValue( new CliUpdateInProgressError() );

	await commandHandler( {} as Parameters< typeof commandHandler >[ 0 ] );

	expect( process.exitCode ).toBe( 1 );
	expect( report ).toHaveBeenCalledOnce();
	expect( report.mock.calls[ 0 ][ 0 ].message ).toBe(
		'Another WordPress Studio CLI update is in progress. Try again when it finishes.'
	);
	expect( report.mock.calls[ 0 ][ 0 ].previousError ).toBeUndefined();
	expect( reportCommandFailure ).not.toHaveBeenCalled();
} );
