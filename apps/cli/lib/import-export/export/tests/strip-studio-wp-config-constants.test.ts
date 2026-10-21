import { stripStudioWpConfigConstants } from '../strip-studio-wp-config-constants';

describe( 'stripStudioWpConfigConstants', () => {
	it( 'removes the constants Studio writes on site start', () => {
		const content = [
			'<?php',
			"define( 'DB_NAME', 'wordpress' );",
			"define( 'WP_DEBUG', false );",
			"define( 'WP_DEBUG_LOG', false );",
			"define( 'WP_DEBUG_DISPLAY', false );",
			"define( 'SCRIPT_DEBUG', true );",
			"define( 'WP_ENVIRONMENT_TYPE', 'local' );",
			"$table_prefix = 'wp_';",
			"require_once ABSPATH . 'wp-settings.php';",
			'',
		].join( '\n' );

		expect( stripStudioWpConfigConstants( content ) ).toBe(
			[ '<?php', "$table_prefix = 'wp_';", "require_once ABSPATH . 'wp-settings.php';", '' ].join(
				'\n'
			)
		);
	} );

	it( 'removes defines that follow a comment and handles Windows line endings', () => {
		const content =
			"<?php\r\n/**\r\n * Debugging mode.\r\n */\r\ndefine( 'WP_DEBUG', true );\r\n// Environment\r\ndefine( 'WP_ENVIRONMENT_TYPE', 'staging' );\r\n";

		expect( stripStudioWpConfigConstants( content ) ).toBe(
			'<?php\r\n/**\r\n * Debugging mode.\r\n */\r\n// Environment\r\n'
		);
	} );

	it( 'keeps defines written in another form', () => {
		const content = [
			'<?php',
			'define("WP_DEBUG",TRUE);',
			"\tdefine( 'SCRIPT_DEBUG', true );",
			"define( 'WP_DEBUG_LOG', '/tmp/debug.log' );",
			"define( 'WP_DEBUG', getenv( 'WP_DEBUG' ) === '1' );",
			"define( 'WP_ENVIRONMENT_TYPE', 'qa' );",
			'',
		].join( '\n' );

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );

	it( 'keeps a define that is the body of a brace-less statement', () => {
		const content = [
			'<?php',
			"if ( getenv( 'DEBUG' ) )",
			"define( 'WP_DEBUG', true );",
			'else',
			"define( 'WP_DEBUG', false );",
			"if ( ! defined( 'WP_ENVIRONMENT_TYPE' ) ) define( 'WP_ENVIRONMENT_TYPE', 'staging' );",
			'',
		].join( '\n' );

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );

	it( 'keeps a DB_NAME that is not the Studio default', () => {
		const content = "<?php\ndefine( 'DB_NAME', 'my_database' );\n";

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );

	it( 'keeps constants that only share a name prefix', () => {
		const content =
			"<?php\ndefine( 'WP_DEBUG_LOG_LEVEL', 'info' );\ndefine( 'MY_WP_DEBUG', true );\n";

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );
} );
