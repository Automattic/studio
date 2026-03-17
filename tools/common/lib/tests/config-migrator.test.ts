import { applyMigrations, type ConfigMigration } from '@studio/common/lib/config-migrator';

describe( 'applyMigrations', () => {
	it( 'returns data unchanged when no migrations exist', () => {
		const data = { version: 1, foo: 'bar' };
		expect( applyMigrations( data, [] ) ).toEqual( data );
	} );

	it( 'returns data unchanged when all migrations are older than current version', () => {
		const data = { version: 3, foo: 'bar' };
		const migrations: ConfigMigration[] = [
			{ version: 2, migrate: ( d ) => ( { ...d, upgraded: true } ) },
		];
		expect( applyMigrations( data, migrations ) ).toEqual( data );
	} );

	it( 'applies a single pending migration', () => {
		const data = { version: 1, foo: 'bar' };
		const migrations: ConfigMigration[] = [
			{ version: 2, migrate: ( d ) => ( { ...d, foo: 'baz' } ) },
		];
		const result = applyMigrations( data, migrations );
		expect( result ).toEqual( { version: 2, foo: 'baz' } );
	} );

	it( 'applies multiple migrations in order', () => {
		const data = { version: 1, count: 0 };
		const migrations: ConfigMigration[] = [
			{ version: 3, migrate: ( d ) => ( { ...d, count: ( d.count as number ) + 10 } ) },
			{ version: 2, migrate: ( d ) => ( { ...d, count: ( d.count as number ) + 1 } ) },
		];
		const result = applyMigrations( data, migrations );
		expect( result ).toEqual( { version: 3, count: 11 } );
	} );

	it( 'only applies migrations newer than current version', () => {
		const data = { version: 2, value: 'original' };
		const migrations: ConfigMigration[] = [
			{ version: 2, migrate: ( d ) => ( { ...d, value: 'should-not-run' } ) },
			{ version: 3, migrate: ( d ) => ( { ...d, value: 'v3' } ) },
		];
		const result = applyMigrations( data, migrations );
		expect( result ).toEqual( { version: 3, value: 'v3' } );
	} );

	it( 'defaults to version 1 when version field is missing', () => {
		const data = { foo: 'bar' };
		const migrations: ConfigMigration[] = [
			{ version: 2, migrate: ( d ) => ( { ...d, migrated: true } ) },
		];
		const result = applyMigrations( data, migrations );
		expect( result ).toEqual( { version: 2, foo: 'bar', migrated: true } );
	} );

	it( 'does not mutate the original data object', () => {
		const data = { version: 1, foo: 'bar' };
		const migrations: ConfigMigration[] = [
			{ version: 2, migrate: ( d ) => ( { ...d, foo: 'baz' } ) },
		];
		applyMigrations( data, migrations );
		expect( data ).toEqual( { version: 1, foo: 'bar' } );
	} );
} );
