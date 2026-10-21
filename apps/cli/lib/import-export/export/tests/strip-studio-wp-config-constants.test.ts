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

	it( 'handles hand-written formatting and Windows line endings', () => {
		const content =
			"<?php\r\ndefine(\"WP_DEBUG\",TRUE);\r\n  define('WP_DEBUG_LOG', '/tmp/debug.log');\r\n";

		expect( stripStudioWpConfigConstants( content ) ).toBe( '<?php\r\n' );
	} );

	it( 'keeps a DB_NAME that is not the Studio default', () => {
		const content = "<?php\ndefine( 'DB_NAME', 'my_database' );\n";

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );

	it( 'keeps defines with computed values or inside conditions', () => {
		const content = [
			'<?php',
			"define( 'WP_DEBUG', getenv( 'WP_DEBUG' ) === '1' );",
			"if ( ! defined( 'WP_ENVIRONMENT_TYPE' ) ) define( 'WP_ENVIRONMENT_TYPE', 'staging' );",
			'',
		].join( '\n' );

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );

	it( 'keeps constants that only share a name prefix', () => {
		const content =
			"<?php\ndefine( 'WP_DEBUG_LOG_LEVEL', 'info' );\ndefine( 'MY_WP_DEBUG', true );\n";

		expect( stripStudioWpConfigConstants( content ) ).toBe( content );
	} );
} );
