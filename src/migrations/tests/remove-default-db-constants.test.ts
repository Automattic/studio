import {
	hasDefaultDbBlock,
	removeDbConstants,
} from 'src/migrations/remove-default-db-constants';

const WP_CONFIG_WITH_DEFAULTS = `<?php
/**
 * The base configuration for WordPress
 */

// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'database_name_here' );

/** Database username */
define( 'DB_USER', 'username_here' );

/** Database password */
define( 'DB_PASSWORD', 'password_here' );

/** Database hostname */
define( 'DB_HOST', 'localhost' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8mb4' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', '' );

$table_prefix = 'wp_';

define( 'WP_DEBUG', false );

/* That's all, stop editing! Happy publishing. */
`;

const WP_CONFIG_WITH_CUSTOM_VALUES = `<?php
/**
 * The base configuration for WordPress
 */

// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'my_production_db' );

/** Database username */
define( 'DB_USER', 'admin_user' );

/** Database password */
define( 'DB_PASSWORD', 'super_secret_password' );

/** Database hostname */
define( 'DB_HOST', 'db.example.com' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8mb4' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', '' );

$table_prefix = 'wp_';

define( 'WP_DEBUG', false );
`;

const WP_CONFIG_WITH_MIXED_VALUES = `<?php
// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'database_name_here' );

/** Database username */
define( 'DB_USER', 'custom_user' );

/** Database password */
define( 'DB_PASSWORD', 'password_here' );

/** Database hostname */
define( 'DB_HOST', 'localhost' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8mb4' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', '' );
`;

const WP_CONFIG_ALREADY_MIGRATED = `<?php
/**
 * The base configuration for WordPress
 */

/**
 * Database connection information is automatically provided.
 * There is no need to set or change the following database configuration
 * values:
 *   DB_HOST
 *   DB_NAME
 *   DB_USER
 *   DB_PASSWORD
 *   DB_CHARSET
 *   DB_COLLATE
 */

$table_prefix = 'wp_';

define( 'WP_DEBUG', false );
`;

describe( 'hasDefaultDbBlock', () => {
	it( 'should return true when the exact default DB block is present', () => {
		expect( hasDefaultDbBlock( WP_CONFIG_WITH_DEFAULTS ) ).toBe( true );
	} );

	it( 'should return false when DB values are custom', () => {
		expect( hasDefaultDbBlock( WP_CONFIG_WITH_CUSTOM_VALUES ) ).toBe( false );
	} );

	it( 'should return false when DB values are mixed', () => {
		expect( hasDefaultDbBlock( WP_CONFIG_WITH_MIXED_VALUES ) ).toBe( false );
	} );

	it( 'should return false when no DB constants found', () => {
		expect( hasDefaultDbBlock( '<?php\n$foo = "bar";\n' ) ).toBe( false );
	} );

	it( 'should return false for already migrated content', () => {
		expect( hasDefaultDbBlock( WP_CONFIG_ALREADY_MIGRATED ) ).toBe( false );
	} );
} );

describe( 'removeDbConstants', () => {
	it( 'should remove the entire DB settings block', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).not.toContain( '// ** Database settings' );
		expect( result ).not.toContain( "define( 'DB_NAME'" );
		expect( result ).not.toContain( "define( 'DB_USER'" );
		expect( result ).not.toContain( "define( 'DB_PASSWORD'" );
		expect( result ).not.toContain( "define( 'DB_HOST'" );
		expect( result ).not.toContain( "define( 'DB_CHARSET'" );
		expect( result ).not.toContain( "define( 'DB_COLLATE'" );
		expect( result ).not.toContain( 'The name of the database for WordPress' );
		expect( result ).not.toContain( 'Database username' );
		expect( result ).not.toContain( 'Database password' );
		expect( result ).not.toContain( 'Database hostname' );
	} );

	it( 'should add the replacement comment block', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).toContain( 'Database connection information is automatically provided' );
	} );

	it( 'should preserve other defines', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).toContain( "define( 'WP_DEBUG', false )" );
	} );

	it( 'should preserve table_prefix', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).toContain( "$table_prefix = 'wp_'" );
	} );

	it( 'should preserve the WordPress header comment', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).toContain( 'The base configuration for WordPress' );
	} );
} );

describe( 'integration: full migration flow', () => {
	it( 'should correctly process a standard wp-config.php with defaults', () => {
		expect( hasDefaultDbBlock( WP_CONFIG_WITH_DEFAULTS ) ).toBe( true );

		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );
		expect( result ).toContain( 'Database connection information is automatically provided' );
	} );

	it( 'should not modify wp-config.php with custom values', () => {
		expect( hasDefaultDbBlock( WP_CONFIG_WITH_CUSTOM_VALUES ) ).toBe( false );
	} );

	it( 'should not modify wp-config.php with mixed values', () => {
		expect( hasDefaultDbBlock( WP_CONFIG_WITH_MIXED_VALUES ) ).toBe( false );
	} );

	it( 'should be idempotent - migrated file has no default block', () => {
		const firstRun = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );
		expect( hasDefaultDbBlock( firstRun ) ).toBe( false );
	} );
} );
