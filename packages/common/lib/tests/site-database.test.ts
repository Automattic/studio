import path from 'path';
import { vol } from 'memfs';
import { getSiteDatabaseEngine, getSiteDatabasePath } from '../site-database';

vi.mock( 'fs' );

describe( 'site database', () => {
	const sitePath = '/site';

	beforeEach( () => {
		vol.reset();
	} );

	it( 'keeps the current database location for absolute and relative site paths', () => {
		expect( getSiteDatabasePath( sitePath ) ).toBe(
			path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' )
		);
		expect( getSiteDatabasePath( 'site' ) ).toBe(
			path.join( 'site', 'wp-content', 'database', '.ht.sqlite' )
		);
	} );

	it( 'defaults fresh sites and descriptions without a selected site to SQLite', () => {
		expect( getSiteDatabaseEngine() ).toBe( 'sqlite' );
		expect( getSiteDatabaseEngine( sitePath ) ).toBe( 'sqlite' );
	} );

	it( 'preserves an external database configuration with no SQLite artifacts', () => {
		vol.fromJSON( { '/site/wp-config.php': '<?php' } );
		expect( getSiteDatabaseEngine( sitePath ) ).toBe( 'mysql' );
	} );

	it.each( [
		'wp-content/db.php',
		'wp-content/database/.ht.sqlite',
		'wp-content/mu-plugins/sqlite-database-integration/load.php',
	] )( 'detects SQLite from %s even when wp-config.php exists', ( artifact ) => {
		vol.fromJSON( {
			'/site/wp-config.php': '<?php',
			[ path.join( sitePath, artifact ) ]: '',
		} );
		expect( getSiteDatabaseEngine( sitePath ) ).toBe( 'sqlite' );
	} );

	it( 'uses the provider’s integration directory when detecting an existing integration', () => {
		vol.fromJSON( {
			'/site/wp-config.php': '<?php',
			'/site/wp-content/mu-plugins/custom-integration/load.php': '',
		} );
		expect( getSiteDatabaseEngine( sitePath, 'custom-integration' ) ).toBe( 'sqlite' );
	} );
} );
