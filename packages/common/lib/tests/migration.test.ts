import { runMigrations, type Migration } from '@studio/common/lib/migration';

describe( 'runMigrations', () => {
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
