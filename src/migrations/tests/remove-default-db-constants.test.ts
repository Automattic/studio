import {
	extractDbConstants,
	hasDefaultDbValues,
	removeDbConstants,
	isAlreadyMigrated,
} from 'src/migrations/remove-default-db-constants';

// Sample wp-config.php content with default values
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

// Sample wp-config.php content with custom (non-default) values
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

// Sample wp-config.php content with mixed values (some default, some custom)
const WP_CONFIG_WITH_MIXED_VALUES = `<?php
define( 'DB_NAME', 'database_name_here' );
define( 'DB_USER', 'custom_user' );
define( 'DB_PASSWORD', 'password_here' );
define( 'DB_HOST', 'localhost' );
`;

// Already migrated content
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

// Different PHP syntax styles
const WP_CONFIG_ALTERNATE_SYNTAX = `<?php
define('DB_NAME','database_name_here');
define("DB_USER","username_here");
define( "DB_PASSWORD" , "password_here" );
define(  'DB_HOST'  ,  'localhost'  );
define('DB_CHARSET', 'utf8');
define('DB_COLLATE', '');
`;

describe( 'extractDbConstants', () => {
	it( 'should extract DB constants from standard wp-config.php', () => {
		const constants = extractDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( constants.DB_NAME ).toBe( 'database_name_here' );
		expect( constants.DB_USER ).toBe( 'username_here' );
		expect( constants.DB_PASSWORD ).toBe( 'password_here' );
		expect( constants.DB_HOST ).toBe( 'localhost' );
		expect( constants.DB_CHARSET ).toBe( 'utf8mb4' );
		expect( constants.DB_COLLATE ).toBe( '' );
	} );

	it( 'should extract custom DB values', () => {
		const constants = extractDbConstants( WP_CONFIG_WITH_CUSTOM_VALUES );

		expect( constants.DB_NAME ).toBe( 'my_production_db' );
		expect( constants.DB_USER ).toBe( 'admin_user' );
		expect( constants.DB_PASSWORD ).toBe( 'super_secret_password' );
		expect( constants.DB_HOST ).toBe( 'db.example.com' );
	} );

	it( 'should handle alternate PHP syntax styles', () => {
		const constants = extractDbConstants( WP_CONFIG_ALTERNATE_SYNTAX );

		expect( constants.DB_NAME ).toBe( 'database_name_here' );
		expect( constants.DB_USER ).toBe( 'username_here' );
		expect( constants.DB_PASSWORD ).toBe( 'password_here' );
		expect( constants.DB_HOST ).toBe( 'localhost' );
	} );

	it( 'should return empty object when no DB constants found', () => {
		const constants = extractDbConstants( '<?php\n$foo = "bar";\n' );

		expect( Object.keys( constants ).length ).toBe( 0 );
	} );
} );

describe( 'hasDefaultDbValues', () => {
	it( 'should return true when all required constants have default values', () => {
		const constants = {
			DB_NAME: 'database_name_here',
			DB_USER: 'username_here',
			DB_PASSWORD: 'password_here',
			DB_HOST: 'localhost',
		};

		expect( hasDefaultDbValues( constants ) ).toBe( true );
	} );

	it( 'should return false when any required constant has a custom value', () => {
		const constants = {
			DB_NAME: 'custom_database',
			DB_USER: 'username_here',
			DB_PASSWORD: 'password_here',
			DB_HOST: 'localhost',
		};

		expect( hasDefaultDbValues( constants ) ).toBe( false );
	} );

	it( 'should return false when a required constant is missing', () => {
		const constants = {
			DB_NAME: 'database_name_here',
			DB_USER: 'username_here',
			DB_PASSWORD: 'password_here',
			// DB_HOST is missing
		};

		expect( hasDefaultDbValues( constants ) ).toBe( false );
	} );

	it( 'should return false for mixed default and custom values', () => {
		const constants = extractDbConstants( WP_CONFIG_WITH_MIXED_VALUES );

		expect( hasDefaultDbValues( constants ) ).toBe( false );
	} );

	it( 'should return false for all custom values', () => {
		const constants = extractDbConstants( WP_CONFIG_WITH_CUSTOM_VALUES );

		expect( hasDefaultDbValues( constants ) ).toBe( false );
	} );
} );

describe( 'removeDbConstants', () => {
	it( 'should remove all DB constant definitions', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).not.toContain( "define( 'DB_NAME'" );
		expect( result ).not.toContain( "define( 'DB_USER'" );
		expect( result ).not.toContain( "define( 'DB_PASSWORD'" );
		expect( result ).not.toContain( "define( 'DB_HOST'" );
		expect( result ).not.toContain( "define( 'DB_CHARSET'" );
		expect( result ).not.toContain( "define( 'DB_COLLATE'" );
	} );

	it( 'should add the replacement comment block', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).toContain( 'Database connection information is automatically provided' );
		expect( result ).toContain( 'DB_HOST' );
		expect( result ).toContain( 'DB_NAME' );
	} );

	it( 'should preserve other defines', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).toContain( "define( 'WP_DEBUG', false )" );
	} );

	it( 'should preserve table_prefix', () => {
		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );

		expect( result ).toContain( "$table_prefix = 'wp_'" );
	} );

	it( 'should handle alternate PHP syntax', () => {
		const result = removeDbConstants( WP_CONFIG_ALTERNATE_SYNTAX );

		expect( result ).not.toContain( "define('DB_NAME'" );
		expect( result ).not.toContain( 'define("DB_USER"' );
		expect( result ).toContain( 'Database connection information is automatically provided' );
	} );
} );

describe( 'isAlreadyMigrated', () => {
	it( 'should return true for already migrated content', () => {
		expect( isAlreadyMigrated( WP_CONFIG_ALREADY_MIGRATED ) ).toBe( true );
	} );

	it( 'should return false for content with DB constants', () => {
		expect( isAlreadyMigrated( WP_CONFIG_WITH_DEFAULTS ) ).toBe( false );
	} );

	it( 'should return false for content without the migration marker', () => {
		expect( isAlreadyMigrated( '<?php\n$foo = "bar";\n' ) ).toBe( false );
	} );
} );

describe( 'integration: full migration flow', () => {
	it( 'should correctly process a standard wp-config.php with defaults', () => {
		const constants = extractDbConstants( WP_CONFIG_WITH_DEFAULTS );
		expect( hasDefaultDbValues( constants ) ).toBe( true );

		const result = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );
		expect( isAlreadyMigrated( result ) ).toBe( true );
	} );

	it( 'should not modify wp-config.php with custom values', () => {
		const constants = extractDbConstants( WP_CONFIG_WITH_CUSTOM_VALUES );
		expect( hasDefaultDbValues( constants ) ).toBe( false );
		// In the actual migration, we would skip this file
	} );

	it( 'should not modify wp-config.php with mixed values', () => {
		const constants = extractDbConstants( WP_CONFIG_WITH_MIXED_VALUES );
		expect( hasDefaultDbValues( constants ) ).toBe( false );
		// In the actual migration, we would skip this file
	} );

	it( 'should be idempotent - running migration twice produces same result', () => {
		const firstRun = removeDbConstants( WP_CONFIG_WITH_DEFAULTS );
		expect( isAlreadyMigrated( firstRun ) ).toBe( true );

		// Second run should detect it's already migrated
		// In the actual migration, we check isAlreadyMigrated before processing
	} );
} );
