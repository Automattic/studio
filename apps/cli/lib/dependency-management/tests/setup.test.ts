import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { DEPENDENCY_CHECK_INTERVAL_MS, updateServerFiles } from '../setup';
import { updateLatestWordPressVersion } from '../wordpress';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn(),
	updateCliConfigWithPartial: vi.fn(),
} ) );

vi.mock( '../wordpress' );

describe( 'updateServerFiles', () => {
	const NOW = 1_700_000_000_000;

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime( NOW );
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		vi.mocked( updateLatestWordPressVersion ).mockResolvedValue( undefined );
		vi.mocked( updateCliConfigWithPartial ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	describe( 'throttling', () => {
		it( 'runs the update when no timestamp has been recorded', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );

			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'runs the update when the last check is older than the interval', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
				lastDependencyCheckTime: NOW - DEPENDENCY_CHECK_INTERVAL_MS - 1,
			} );

			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'skips the update when the last check is within the interval', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
				lastDependencyCheckTime: NOW - 60 * 1000,
			} );

			const result = await updateServerFiles();

			expect( result ).toBe( false );
			expect( updateLatestWordPressVersion ).not.toHaveBeenCalled();
		} );

		it( 'runs the update when the timestamp is in the future (clock skew)', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
				lastDependencyCheckTime: NOW + 60 * 1000,
			} );

			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'runs the update when reading the config throws', async () => {
			vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'boom' ) );

			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	describe( 'timestamp persistence', () => {
		it( 'persists the current time after a successful update', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );

			await updateServerFiles();

			expect( updateCliConfigWithPartial ).toHaveBeenCalledWith( {
				lastDependencyCheckTime: NOW,
			} );
		} );

		it( 'persists the timestamp even when the update throws', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
			vi.mocked( updateLatestWordPressVersion ).mockRejectedValue( new Error( 'network' ) );

			await updateServerFiles();

			expect( updateCliConfigWithPartial ).toHaveBeenCalledWith( {
				lastDependencyCheckTime: NOW,
			} );
		} );

		it( 'does not persist the timestamp when the check is skipped', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
				lastDependencyCheckTime: NOW - 60 * 1000,
			} );

			await updateServerFiles();

			expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
		} );

		it( 'swallows errors from the timestamp write and logs them', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
			const error = new Error( 'write failed' );
			vi.mocked( updateCliConfigWithPartial ).mockRejectedValue( error );

			await expect( updateServerFiles() ).resolves.toBe( true );
			expect( console.error ).toHaveBeenCalledWith(
				'Failed to persist dependency check timestamp:',
				error
			);
		} );
	} );
} );
