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

	it( 'removes defines written in another form', () => {
		const content = [
			'<?php',
			'define("WP_DEBUG",TRUE);',
			"if ( getenv( 'DEBUG' ) ) {",
			"\tdefine( 'SCRIPT_DEBUG', true );",
			'}',
			'define ( \'WP_DEBUG_LOG\' , "/tmp/debug.log" ) ;',
			"define( 'WP_ENVIRONMENT_TYPE', 'qa' );",
			'',
		].join( '\n' );

		expect( stripStudioWpConfigConstants( content ) ).toBe(
			[ '<?php', "if ( getenv( 'DEBUG' ) ) {", '}', '' ].join( '\n' )
		);
	} );

	it( 'keeps defines with computed values', () => {
		const content = "<?php\ndefine( 'WP_DEBUG', getenv( 'WP_DEBUG' ) === '1' );\n";

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

	it( 'looks past comments for the statement a define belongs to', () => {
		const content = [
			'<?php',
			"if ( getenv( 'X' ) )",
			'// dev only',
			"define( 'WP_DEBUG', true );",
			'else',
			'/**',
			' * Production.',
			' */',
			"define( 'WP_DEBUG', false );",
			'if ( $a ) /* dev */',
			"define( 'SCRIPT_DEBUG', true );",
			'if ( $b ) # dev',
			"define( 'WP_DEBUG_LOG', true );",
			"$table_prefix = 'wp_';",
			'',
		].join( '\n' );

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );

	it( 'removes a define after a comment that follows a complete statement', () => {
		const content = [
			'<?php',
			"define( 'WP_HOME', 'http://example.com' ); // the URL",
			'/* For developers: WordPress debugging mode.',
			" * if ( true ) define( 'WP_DEBUG', true );",
			' */',
			"define( 'WP_DEBUG', false );",
			'',
		].join( '\n' );

		expect( stripStudioWpConfigConstants( content ) ).toBe(
			[
				'<?php',
				"define( 'WP_HOME', 'http://example.com' ); // the URL",
				'/* For developers: WordPress debugging mode.',
				" * if ( true ) define( 'WP_DEBUG', true );",
				' */',
				'',
			].join( '\n' )
		);
	} );

	it( 'keeps a define inside a block comment', () => {
		const content = "<?php\n/*\ndefine( 'WP_DEBUG', true );\n*/\n";

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
