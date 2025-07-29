import { readFileSync } from 'fs';
import nodePath from 'path';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import { PHP, MountHandler, SupportedPHPVersion } from '@php-wasm/universal';
import { pathExists } from 'src/lib/fs-utils';

/**
 * Execute WP-CLI commands with pre-resolved paths
 * Creates a fresh PHP instance without existing database tables to avoid conflicts
 */
export async function executeWPCli(
	projectPath: string,
	args: string[],
	options: {
		phpVersion?: string;
		resourcesPath: string;
		sqliteCommandPath: string;
	}
): Promise< { stdout: string; stderr: string; exitCode: number } > {
	console.log( '[playground-cli] Executing WP-CLI:', args.join( ' ' ) );

	const phpVersion = options.phpVersion || '8.3';

	// Create a fresh PHP instance (similar to wp-now's approach)
	const id = await loadNodeRuntime( phpVersion as SupportedPHPVersion, {
		followSymlinks: true,
	} );

	const php = new PHP( id );

	try {
		// Set CLI SAPI
		await php.setSapiName( 'cli' );

		// Mount project files to /wordpress (WordPress root)
		php.mkdir( '/wordpress' );
		await php.mount(
			'/wordpress',
			createNodeFsMountHandler( projectPath ) as unknown as MountHandler
		);

		// Mount SQLite command
		if ( await pathExists( options.sqliteCommandPath ) ) {
			php.mkdir( '/tmp/sqlite-command' );
			await php.mount(
				'/tmp/sqlite-command',
				createNodeFsMountHandler( options.sqliteCommandPath ) as unknown as MountHandler
			);
		}

		// Mount WP-CLI phar
		const wpCliPharPath = nodePath.join(
			options.resourcesPath,
			'wp-files',
			'wp-cli',
			'wp-cli.phar'
		);
		if ( await pathExists( wpCliPharPath ) ) {
			php.mkdir( '/tmp' );
			php.writeFile( '/tmp/wp-cli.phar', readFileSync( wpCliPharPath ) );
		}

		// Create minimal MU plugins for CLI mode
		await mountCleanMuPlugins( php );

		// Execute WP-CLI command
		return await executeWPCliInPHP( php, args, '/wordpress' );
	} finally {
		// Clean up PHP instance
		php.exit();
	}
}

/**
 * Mount only essential MU plugins for CLI mode (no database setup plugins)
 */
async function mountCleanMuPlugins( php: PHP ): Promise< void > {
	const muPluginsPath = '/wordpress/wp-content/mu-plugins';
	php.mkdir( muPluginsPath );

	// Only include essential plugins that don't interfere with database
	const cleanMuPlugins = [
		{
			filename: '0-https-for-reverse-proxy.php',
			content: `<?php
				if( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && strpos( $_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false ){
					$_SERVER['HTTPS'] = 'on';
				}
			`,
		},
		{
			filename: '0-permalinks.php',
			content: `<?php
				// Support permalinks without "index.php"
				add_filter( 'got_url_rewrite', '__return_true' );
			`,
		},
		{
			filename: '0-sqlite-command.php',
			content: `<?php
				// Ensure SQLite command can find the plugin
				add_filter( 'sqlite_command_sqlite_plugin_directories', function( $directories ) {
					$directories[] = '/wordpress/wp-content/mu-plugins/sqlite-database-integration';
					return $directories;
				} );
			`,
		},
	];

	for ( const plugin of cleanMuPlugins ) {
		php.writeFile( nodePath.posix.join( muPluginsPath, plugin.filename ), plugin.content );
	}
}

/**
 * Execute WP-CLI command within a PHP instance
 */
async function executeWPCliInPHP(
	php: PHP,
	args: string[],
	documentRoot: string
): Promise< { stdout: string; stderr: string; exitCode: number } > {
	const stderrPath = '/tmp/stderr';
	const runCliPath = '/tmp/run-cli.php';

	// Create PHP script to execute WP-CLI (similar to wp-now approach)
	const phpScript = `<?php
// Set up CLI environment
putenv( 'SHELL_PIPE=0' );

// Set the argv global for WP-CLI
$GLOBALS['argv'] = array_merge([
	"/tmp/wp-cli.phar",
	"--path=${ documentRoot }"
], ${ JSON.stringify( args ) });

// Provide CLI streams
define('STDIN', fopen('php://stdin', 'rb'));
define('STDOUT', fopen('php://stdout', 'wb'));
define('STDERR', fopen('${ stderrPath }', 'wb'));

// Set server argv for WP-CLI
$_SERVER['argv'] = $GLOBALS['argv'];
$_SERVER['argc'] = count($_SERVER['argv']);

// Change to WordPress directory
chdir('${ documentRoot }');

// Include WP-CLI phar
if (file_exists('/tmp/wp-cli.phar')) {
	require '/tmp/wp-cli.phar';
} else {
	echo "WP-CLI phar not found";
	exit(1);
}
`;

	// Write the PHP script and stderr file
	php.writeFile( runCliPath, phpScript );
	php.writeFile( stderrPath, '' );

	try {
		// Execute the PHP script
		const result = await php.run( {
			scriptPath: runCliPath,
		} );

		// Read stderr
		const stderr = php.readFileAsText( stderrPath ).trim();

		// Filter out shebang line that sometimes appears in WP-CLI output
		const cleanStdout = result.text
			.split( '\n' )
			.filter( ( line ) => ! line.startsWith( '#!/' ) )
			.join( '\n' )
			.trim();

		return {
			stdout: cleanStdout,
			stderr: stderr,
			exitCode: result.exitCode,
		};
	} catch ( error ) {
		const stderr = php.readFileAsText( stderrPath ).trim();
		return {
			stdout: '',
			stderr: stderr || ( error instanceof Error ? error.message : 'Unknown error' ),
			exitCode: 1,
		};
	}
}
