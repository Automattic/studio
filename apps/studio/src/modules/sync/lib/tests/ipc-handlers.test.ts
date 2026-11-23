import * as Sentry from '@sentry/electron/main';
import { CliCommandError } from '@studio/common/lib/cli-process';
import { readSitePath } from '@studio/common/sites/site-path';
import { vi } from 'vitest';
import { pullSite, pushSite } from 'src/modules/sync/lib/ipc-handlers';
import type { IpcMainInvokeEvent } from 'electron';

const { pull, push } = vi.hoisted( () => ( { pull: vi.fn(), push: vi.fn() } ) );

vi.mock( '@sentry/electron/main', () => ( { captureException: vi.fn() } ) );
vi.mock( '@studio/common/sites/site-path', () => ( { readSitePath: vi.fn() } ) );
vi.mock( '@studio/common/sites/sync', () => ( {
	createSyncRunner: () => ( { pull, push, cancel: vi.fn() } ),
} ) );
vi.mock( 'src/modules/cli/lib/execute-command', () => ( { executeCliCommand: vi.fn() } ) );

const event = {} as IpcMainInvokeEvent;

describe( 'sync failure reporting', () => {
	beforeEach( () => {
		vi.mocked( readSitePath ).mockResolvedValue( '/sites/test' );
	} );
	afterEach( () => vi.unstubAllEnvs() );

	it.each( [
		{ direction: 'pull', run: pullSite, runner: pull, flag: '1', engine: 'reprint' },
		{ direction: 'pull', run: pullSite, runner: pull, flag: undefined, engine: 'backup' },
		{ direction: 'push', run: pushSite, runner: push, flag: undefined, engine: undefined },
	] )(
		'reports a failed $direction (engine $engine) and rethrows it',
		async ( { direction, run, runner, flag, engine } ) => {
			vi.stubEnv( 'STUDIO_ENABLE_PULL_REPRINT', flag );
			const error = new CliCommandError( {
				lastErrorMessage: 'Failed to pull site: preflight_failed',
				cliCommandResult: undefined,
				exitCode: 1,
				signal: null,
			} );
			runner.mockRejectedValue( error );

			await expect( run( event, 'wpcom', 'site-id', 123 ) ).rejects.toBe( error );

			expect( Sentry.captureException ).toHaveBeenCalledWith( error, {
				tags: {
					provider: 'cli',
					sync_direction: direction,
					sync_provider: 'wpcom',
					...( engine ? { pull_engine: engine } : {} ),
				},
			} );
		}
	);

	it( 'does not report a cancelled sync', async () => {
		pull.mockResolvedValue( { cancelled: true } );

		await expect( pullSite( event, 'wpcom', 'site-id', 123 ) ).resolves.toEqual( {
			cancelled: true,
		} );
		expect( Sentry.captureException ).not.toHaveBeenCalled();
	} );
} );
