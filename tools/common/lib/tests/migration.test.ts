import { runMigrations, type Migration } from '@studio/common/lib/migration';

describe( 'runMigrations', () => {
	it( 'does nothing when migrations array is empty', async () => {
		await expect( runMigrations( [] ) ).resolves.toBeUndefined();
	} );

	it( 'skips migrations that do not need to run', async () => {
		const run = vi.fn();
		const migrations: Migration[] = [ { needsToRun: async () => false, run } ];
		await runMigrations( migrations );
		expect( run ).not.toHaveBeenCalled();
	} );

	it( 'runs migrations that need to run', async () => {
		const run = vi.fn();
		const migrations: Migration[] = [ { needsToRun: async () => true, run } ];
		await runMigrations( migrations );
		expect( run ).toHaveBeenCalledOnce();
	} );

	it( 'runs multiple migrations in order', async () => {
		const order: string[] = [];
		const migrations: Migration[] = [
			{
				needsToRun: async () => true,
				run: async () => {
					order.push( 'first' );
				},
			},
			{
				needsToRun: async () => true,
				run: async () => {
					order.push( 'second' );
				},
			},
		];
		await runMigrations( migrations );
		expect( order ).toEqual( [ 'first', 'second' ] );
	} );

	it( 'only runs migrations that need to run', async () => {
		const order: string[] = [];
		const migrations: Migration[] = [
			{
				needsToRun: async () => true,
				run: async () => {
					order.push( 'yes' );
				},
			},
			{
				needsToRun: async () => false,
				run: async () => {
					order.push( 'no' );
				},
			},
			{
				needsToRun: async () => true,
				run: async () => {
					order.push( 'also-yes' );
				},
			},
		];
		await runMigrations( migrations );
		expect( order ).toEqual( [ 'yes', 'also-yes' ] );
	} );

	it( 'throws when a migration that needs to run fails', async () => {
		const migrations: Migration[] = [
			{
				needsToRun: async () => true,
				run: async () => {
					throw new Error( 'migration failed' );
				},
			},
		];
		await expect( runMigrations( migrations ) ).rejects.toThrow( 'migration failed' );
	} );

	it( 'stops on first failure and does not run subsequent migrations', async () => {
		const thirdRun = vi.fn();
		const migrations: Migration[] = [
			{
				needsToRun: async () => true,
				run: async () => {},
			},
			{
				needsToRun: async () => true,
				run: async () => {
					throw new Error( 'boom' );
				},
			},
			{
				needsToRun: async () => true,
				run: thirdRun,
			},
		];
		await expect( runMigrations( migrations ) ).rejects.toThrow( 'boom' );
		expect( thirdRun ).not.toHaveBeenCalled();
	} );
} );
