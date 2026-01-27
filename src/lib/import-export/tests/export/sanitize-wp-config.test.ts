import { sanitizeWpConfig } from 'src/lib/import-export/export/sanitize-wp-config';

describe( 'sanitizeWpConfig', () => {
	it( 'should wrap simple define statements with defined() checks', () => {
		const input = `<?php
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', false );
`;
		const expected = `<?php
if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', true ); }
if ( ! defined( 'WP_DEBUG_LOG' ) ) { define( 'WP_DEBUG_LOG', false ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle string values with single quotes', () => {
		const input = `<?php
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'root' );
`;
		const expected = `<?php
if ( ! defined( 'DB_NAME' ) ) { define( 'DB_NAME', 'wordpress' ); }
if ( ! defined( 'DB_USER' ) ) { define( 'DB_USER', 'root' ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle string values with double quotes', () => {
		const input = `<?php
define( "WP_HOME", "http://localhost:8080" );
define( "WP_SITEURL", "http://localhost:8080" );
`;
		const expected = `<?php
if ( ! defined( 'WP_HOME' ) ) { define( "WP_HOME", "http://localhost:8080" ); }
if ( ! defined( 'WP_SITEURL' ) ) { define( "WP_SITEURL", "http://localhost:8080" ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should preserve indentation', () => {
		const input = `<?php
	define( 'WP_DEBUG', true );
		define( 'WP_DEBUG_LOG', false );
`;
		const expected = `<?php
	if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', true ); }
		if ( ! defined( 'WP_DEBUG_LOG' ) ) { define( 'WP_DEBUG_LOG', false ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle define without spaces', () => {
		const input = `<?php
define('WP_DEBUG',true);
`;
		const expected = `<?php
if ( ! defined( 'WP_DEBUG' ) ) { define('WP_DEBUG',true); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle define with extra spaces', () => {
		const input = `<?php
define(   'WP_DEBUG'  ,   true   );
`;
		const expected = `<?php
if ( ! defined( 'WP_DEBUG' ) ) { define(   'WP_DEBUG'  ,   true   ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should not wrap constants that are already wrapped with defined() check', () => {
		const input = `<?php
if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', true ); }
define( 'WP_DEBUG_LOG', false );
`;
		const expected = `<?php
if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', true ); }
if ( ! defined( 'WP_DEBUG_LOG' ) ) { define( 'WP_DEBUG_LOG', false ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle ABSPATH constant', () => {
		const input = `<?php
define( 'ABSPATH', __DIR__ . '/' );
`;
		const expected = `<?php
if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle constants with underscores and numbers', () => {
		const input = `<?php
define( 'WP_MEMORY_LIMIT', '256M' );
define( 'WP_MAX_MEMORY_LIMIT', '512M' );
define( 'CUSTOM_CONSTANT_123', 'value' );
`;
		const expected = `<?php
if ( ! defined( 'WP_MEMORY_LIMIT' ) ) { define( 'WP_MEMORY_LIMIT', '256M' ); }
if ( ! defined( 'WP_MAX_MEMORY_LIMIT' ) ) { define( 'WP_MAX_MEMORY_LIMIT', '512M' ); }
if ( ! defined( 'CUSTOM_CONSTANT_123' ) ) { define( 'CUSTOM_CONSTANT_123', 'value' ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should not modify non-define statements', () => {
		const input = `<?php
$table_prefix = 'wp_';
require_once ABSPATH . 'wp-settings.php';
`;
		expect( sanitizeWpConfig( input ) ).toBe( input );
	} );

	it( 'should handle mixed content with defines and other code', () => {
		const input = `<?php
// Database settings
define( 'DB_NAME', 'wordpress' );

$table_prefix = 'wp_';

// Debug settings
define( 'WP_DEBUG', true );

require_once ABSPATH . 'wp-settings.php';
`;
		const expected = `<?php
// Database settings
if ( ! defined( 'DB_NAME' ) ) { define( 'DB_NAME', 'wordpress' ); }

$table_prefix = 'wp_';

// Debug settings
if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', true ); }

require_once ABSPATH . 'wp-settings.php';
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle defines inside conditionals correctly', () => {
		// When a define is inside an if block, it should still be wrapped
		const input = `<?php
if ( file_exists( 'config.php' ) ) {
	define( 'HAS_CONFIG', true );
}
define( 'WP_DEBUG', false );
`;
		const expected = `<?php
if ( file_exists( 'config.php' ) ) {
	if ( ! defined( 'HAS_CONFIG' ) ) { define( 'HAS_CONFIG', true ); }
}
if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', false ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle empty string input', () => {
		expect( sanitizeWpConfig( '' ) ).toBe( '' );
	} );

	it( 'should handle array values in define', () => {
		const input = `<?php
define( 'AUTH_KEY', 'put your unique phrase here' );
define( 'SECURE_AUTH_KEY', 'put your unique phrase here' );
`;
		const expected = `<?php
if ( ! defined( 'AUTH_KEY' ) ) { define( 'AUTH_KEY', 'put your unique phrase here' ); }
if ( ! defined( 'SECURE_AUTH_KEY' ) ) { define( 'SECURE_AUTH_KEY', 'put your unique phrase here' ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle getenv() and other function calls in define values', () => {
		const input = `<?php
define( 'DB_NAME', getenv( 'DB_NAME' ) );
define( 'DB_HOST', getenv( 'DB_HOST' ) ?: 'localhost' );
`;
		const expected = `<?php
if ( ! defined( 'DB_NAME' ) ) { define( 'DB_NAME', getenv( 'DB_NAME' ) ); }
if ( ! defined( 'DB_HOST' ) ) { define( 'DB_HOST', getenv( 'DB_HOST' ) ?: 'localhost' ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should handle numeric values', () => {
		const input = `<?php
define( 'WP_CRON_LOCK_TIMEOUT', 60 );
define( 'AUTOSAVE_INTERVAL', 160 );
`;
		const expected = `<?php
if ( ! defined( 'WP_CRON_LOCK_TIMEOUT' ) ) { define( 'WP_CRON_LOCK_TIMEOUT', 60 ); }
if ( ! defined( 'AUTOSAVE_INTERVAL' ) ) { define( 'AUTOSAVE_INTERVAL', 160 ); }
`;
		expect( sanitizeWpConfig( input ) ).toBe( expected );
	} );

	it( 'should not modify lowercase function-like calls that are not constants', () => {
		// PHP constants are traditionally UPPERCASE, lowercase define names are rare
		// but the regex should still handle standard WordPress constants
		const input = `<?php
define( 'WP_DEBUG', true );
some_function( 'test', 'value' );
`;
		const result = sanitizeWpConfig( input );
		expect( result ).toContain( "if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', true ); }" );
		expect( result ).toContain( "some_function( 'test', 'value' );" );
	} );

	it( 'should handle a realistic wp-config.php file', () => {
		const input = `<?php
/**
 * The base configuration for WordPress
 */

// ** Database settings - You can get this info from your web host ** //
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', '' );
define( 'DB_HOST', 'localhost' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );

$table_prefix = 'wp_';

define( 'WP_DEBUG', false );

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}

require_once ABSPATH . 'wp-settings.php';
`;
		const result = sanitizeWpConfig( input );

		// Check that all defines are wrapped
		expect( result ).toContain(
			"if ( ! defined( 'DB_NAME' ) ) { define( 'DB_NAME', 'wordpress' ); }"
		);
		expect( result ).toContain( "if ( ! defined( 'DB_USER' ) ) { define( 'DB_USER', 'root' ); }" );
		expect( result ).toContain(
			"if ( ! defined( 'DB_PASSWORD' ) ) { define( 'DB_PASSWORD', '' ); }"
		);
		expect( result ).toContain(
			"if ( ! defined( 'DB_HOST' ) ) { define( 'DB_HOST', 'localhost' ); }"
		);
		expect( result ).toContain(
			"if ( ! defined( 'DB_CHARSET' ) ) { define( 'DB_CHARSET', 'utf8' ); }"
		);
		expect( result ).toContain(
			"if ( ! defined( 'DB_COLLATE' ) ) { define( 'DB_COLLATE', '' ); }"
		);
		expect( result ).toContain( "if ( ! defined( 'WP_DEBUG' ) ) { define( 'WP_DEBUG', false ); }" );

		// Check that $table_prefix and require_once are not modified
		expect( result ).toContain( "$table_prefix = 'wp_';" );
		expect( result ).toContain( "require_once ABSPATH . 'wp-settings.php';" );
	} );
} );
