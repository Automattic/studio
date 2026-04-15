import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import {
	DEPENDENCY_CHECK_INTERVAL_MS,
	markDependencyCheckTime,
	shouldCheckDependencyUpdates,
} from '../setup';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn(),
	updateCliConfigWithPartial: vi.fn(),
} ) );

describe( 'dependency-management/setup throttling', () => {
	const NOW = 1_700_000_000_000;

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime( NOW );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	describe( 'shouldCheckDependencyUpdates', () => {
		it( 'returns true when no timestamp has been recorded', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
			await expect( shouldCheckDependencyUpdates() ).resolves.toBe( true );
		} );

		it( 'returns true when the last check is older than the interval', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
				lastDependencyCheckTime: NOW - DEPENDENCY_CHECK_INTERVAL_MS - 1,
			} );
			await expect( shouldCheckDependencyUpdates() ).resolves.toBe( true );
		} );

		it( 'returns false when the last check is within the interval', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
				lastDependencyCheckTime: NOW - 60 * 1000,
			} );
			await expect( shouldCheckDependencyUpdates() ).resolves.toBe( false );
		} );

		it( 'returns true when the timestamp is in the future (clock skew)', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
				lastDependencyCheckTime: NOW + 60 * 1000,
			} );
			await expect( shouldCheckDependencyUpdates() ).resolves.toBe( true );
		} );

		it( 'returns true when reading the config throws', async () => {
			vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'boom' ) );
			await expect( shouldCheckDependencyUpdates() ).resolves.toBe( true );
		} );
	} );

	describe( 'markDependencyCheckTime', () => {
		it( 'persists the current time to the cli config', async () => {
			vi.mocked( updateCliConfigWithPartial ).mockResolvedValue( undefined );
			await markDependencyCheckTime();
			expect( updateCliConfigWithPartial ).toHaveBeenCalledWith( {
				lastDependencyCheckTime: NOW,
			} );
		} );

		it( 'swallows errors from the cli config write and logs them', async () => {
			const consoleErrorSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
			const error = new Error( 'write failed' );
			vi.mocked( updateCliConfigWithPartial ).mockRejectedValue( error );
			await expect( markDependencyCheckTime() ).resolves.toBeUndefined();
			expect( consoleErrorSpy ).toHaveBeenCalledWith(
				'Failed to persist dependency check timestamp:',
				error
			);
			consoleErrorSpy.mockRestore();
		} );
	} );
} );
