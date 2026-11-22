import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEPENDENCY_CHECK_INTERVAL_MS, updateServerFiles } from '../setup';
import { updateLatestWordPressVersion } from '../wordpress';

let config: { cli: { lastDependencyCheckTime?: number } };

vi.mock( '@studio/common/lib/config/store', () => ( {
	readConfig: vi.fn( async () => config ),
	updateConfig: vi.fn( async ( update: ( value: typeof config ) => void ) => update( config ) ),
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
		config = { cli: {} };
	} );

	afterEach( () => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	describe( 'throttling', () => {
		it( 'runs the update when no timestamp has been recorded', async () => {
			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'runs the update when the last check is older than the interval', async () => {
			config.cli.lastDependencyCheckTime = NOW - DEPENDENCY_CHECK_INTERVAL_MS - 1;

			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'skips the update when the last check is within the interval', async () => {
			config.cli.lastDependencyCheckTime = NOW - 60 * 1000;

			const result = await updateServerFiles();

			expect( result ).toBe( false );
			expect( updateLatestWordPressVersion ).not.toHaveBeenCalled();
		} );

		it( 'runs the update when the timestamp is in the future (clock skew)', async () => {
			config.cli.lastDependencyCheckTime = NOW + 60 * 1000;

			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'runs the update when reading the config throws', async () => {
			vi.mocked( readConfig ).mockRejectedValueOnce( new Error( 'boom' ) );

			const result = await updateServerFiles();

			expect( result ).toBe( true );
			expect( updateLatestWordPressVersion ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	describe( 'timestamp persistence', () => {
		it( 'persists the current time after a successful update', async () => {
			await updateServerFiles();

			expect( config.cli.lastDependencyCheckTime ).toBe( NOW );
		} );

		it( 'persists the timestamp even when the update throws', async () => {
			vi.mocked( updateLatestWordPressVersion ).mockRejectedValue( new Error( 'network' ) );

			await updateServerFiles();

			expect( config.cli.lastDependencyCheckTime ).toBe( NOW );
		} );

		it( 'does not persist the timestamp when the check is skipped', async () => {
			config.cli.lastDependencyCheckTime = NOW - 60 * 1000;

			await updateServerFiles();

			expect( updateConfig ).not.toHaveBeenCalled();
		} );

		it( 'swallows errors from the timestamp write', async () => {
			vi.mocked( updateConfig ).mockRejectedValueOnce( new Error( 'write failed' ) );

			await expect( updateServerFiles() ).resolves.toBe( true );
		} );
	} );
} );
