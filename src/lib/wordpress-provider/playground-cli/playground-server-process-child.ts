import { SupportedPHPVersion, PHPRunOptions } from '@php-wasm/universal';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import { DEFAULT_LOCALE } from 'common/lib/locale';
import { isWordPressDevVersion } from 'src/lib/wordpress-version-utils';
import { WordPressServerOptions } from '../types';
import { getMuPlugins } from './mu-plugins';
import { PlaygroundCliOptions } from './playground-cli-provider';

interface Message {
	id: number;
	type: string;
	data: {
		options: PlaygroundCliOptions;
		serverOptions: WordPressServerOptions;
		code: string;
	};
}

// Intercept and prefix all console output from playground-cli
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = ( ...args: any[] ) => {
	originalConsoleLog( '[playground-cli]', ...args );
	process.parentPort.postMessage( { type: 'activity' } );
};

console.error = ( ...args: any[] ) => {
	originalConsoleError( '[playground-cli]', ...args );
	process.parentPort.postMessage( { type: 'activity' } );
};

console.warn = ( ...args: any[] ) => {
	originalConsoleWarn( '[playground-cli]', ...args );
	process.parentPort.postMessage( { type: 'activity' } );
};

const originalStdoutWrite = process.stdout.write.bind( process.stdout );
const originalStderrWrite = process.stderr.write.bind( process.stderr );

process.stdout.write = function ( ...args: Parameters< typeof originalStdoutWrite > ) {
	process.parentPort.postMessage( { type: 'activity' } );
	return originalStdoutWrite( ...args );
} as typeof process.stdout.write;

process.stderr.write = function ( ...args: Parameters< typeof originalStderrWrite > ) {
	process.parentPort.postMessage( { type: 'activity' } );
	return originalStderrWrite( ...args );
} as typeof process.stderr.write;

let server: RunCLIServer | null = null;

process.parentPort.on( 'message', async ( event ) => {
	const message = event.data as Message;

	try {
		let result: unknown;

		switch ( message.type ) {
			case 'start-server':
				result = await startServer( message.data.options, message.data.serverOptions );
				break;
			case 'stop-server':
				result = await stopServerFunc();
				break;
			case 'run-php':
				result = await runPhp( message.data );
				break;
			default:
				throw new Error( `Unknown message type: ${ message.type }` );
		}

		process.parentPort.postMessage( { id: message.id, result } );
	} catch ( error ) {
		process.parentPort.postMessage( { id: message.id, error: ( error as Error ).message } );
	}
} );

process.parentPort.postMessage( { type: 'ready' } );

function escapePhpString( str: string ): string {
	return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

async function setAdminPassword( server: RunCLIServer, adminPassword: string ): Promise< void > {
	const phpCode = `<?php
		require_once( '/wordpress/wp-load.php' );
		$user = get_user_by( 'login', 'admin' );
		if ( $user ) {
			wp_set_password( '${ escapePhpString( adminPassword ) }', $user->ID );
		} else {
			$user_data = array(
				'user_login' => 'admin',
				'user_pass' => '${ escapePhpString( adminPassword ) }',
				'user_email' => 'admin@localhost.com',
				'role' => 'administrator',
			);
			wp_insert_user( $user_data );
		}
		echo "Admin password updated";
	?>`;

	await server.playground.run( {
		code: phpCode,
	} );
}

async function startServer(
	options: PlaygroundCliOptions,
	serverOptions: WordPressServerOptions
): Promise< void > {
	if ( server ) {
		return;
	}

	try {
		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( serverOptions );
		const setupSteps = [];
		const defaultConstants = {
			WP_SQLITE_AST_DRIVER: true,
		};
		const mounts = [
			{
				hostPath: options.documentRoot,
				vfsPath: '/wordpress',
			},
			{
				hostPath: studioMuPluginsHostPath,
				vfsPath: '/internal/studio/mu-plugins',
			},
			{
				hostPath: loaderMuPluginHostPath,
				vfsPath: '/internal/shared/mu-plugins/99-studio-loader.php',
			},
		];

		const args: RunCLIArgs = {
			command: 'run-blueprint',
			internalCookieStore: true,
			followSymlinks: true,
			skipSqliteSetup: true,
			port: options.port,
			login: true,
			'mount-before-install': mounts,
			'site-url': serverOptions.absoluteUrl,
			blueprint: options.blueprint || {},
		};

		if ( ! options.isSetupMode ) {
			args.command = 'server';
			args.skipWordPressSetup = true;
		}

		if ( options.phpVersion ) {
			args.php = options.phpVersion as SupportedPHPVersion;
		}

		if ( serverOptions.wordPressVersion ) {
			if ( isWordPressDevVersion( serverOptions.wordPressVersion ) ) {
				args.wp = 'nightly';
			} else {
				args.wp = serverOptions.wordPressVersion;
			}
		}

		if ( options.isSetupMode ) {
			/* Workaround for https://github.com/WordPress/wordpress-playground/issues/2700
			 * Let's revisit this code when the issue is fixed
			 * If setSiteLanguage is set in blueprint we shouldn't need to change the language */
			const blueprintLanguageStep = args.blueprint?.steps?.find(
				( step: { step: string; language?: string } ) => step.step === 'setSiteLanguage'
			);
			const siteLanguage = blueprintLanguageStep?.language || serverOptions.siteLanguage;
			if ( siteLanguage && siteLanguage !== DEFAULT_LOCALE ) {
				setupSteps.push(
					{
						step: 'setSiteLanguage',
						language: siteLanguage,
					},
					{
						step: 'runPHP',
						code: `<?php require_once( '/wordpress/wp-load.php' ); update_option( 'WPLANG', '${ escapePhpString(
							siteLanguage
						) }' ); echo "Language set to: ${ escapePhpString( siteLanguage ) }"; ?>`,
					}
				);
			}

			if ( serverOptions.siteTitle ) {
				setupSteps.push( {
					step: 'runPHP',
					code: `<?php
						require_once( '/wordpress/wp-load.php' );
						update_option( 'blogname', '${ escapePhpString( serverOptions.siteTitle ) }' );
						echo "Site title set to: ${ escapePhpString( serverOptions.siteTitle ) }";
					?>`,
				} );
			}
		}

		args.blueprint.steps = [ ...setupSteps, ...( args.blueprint.steps || [] ) ];
		args.blueprint.constants = { ...args.blueprint.constants, ...defaultConstants };

		server = await runCLI( args );

		if ( serverOptions.adminPassword ) {
			try {
				await setAdminPassword( server, serverOptions.adminPassword );
			} catch {
				console.warn(
					'Failed to set site options, but the server started successfully. Please check your site error log in wp-content/debug.log for more details'
				);
			}
		}
	} catch ( error ) {
		server = null;
		throw new Error( `Could not start server: ${ error }` );
	}
}

async function stopServerFunc(): Promise< void > {
	if ( ! server ) {
		return;
	}

	try {
		await server[ Symbol.asyncDispose ]();
	} catch ( error ) {
		// Suppress expected disposal errors that occur during site deletion
		// These are typically race conditions that don't affect functionality
		const errorMessage = error instanceof Error ? error.message : String( error );
		if ( ! errorMessage.includes( 'Cannot read properties of undefined' ) ) {
			console.warn( 'Error during server disposal:', error );
		}
	} finally {
		server = null;
	}
}

async function runPhp( options: {
	code: string;
	scriptPath?: string;
	phpVersion?: string;
} ): Promise< string > {
	if ( ! server ) {
		throw new Error( 'Server is not initialized. Make sure the server is started.' );
	}

	try {
		// Replace host filesystem paths with VFS paths
		// The document root is mounted at /wordpress in the VFS
		let modifiedCode = options.code;

		modifiedCode = modifiedCode.replace(
			/((?:require_once|require|include_once|include)\s*\(\s*['"])([^'"]+)(['"]\s*\))/g,
			( match, prefix, path, suffix ) => {
				// Don't modify phar:// paths
				if ( path.startsWith( 'phar://' ) ) {
					return match;
				}

				if ( path.startsWith( '/' ) && ! path.startsWith( '/wordpress' ) ) {
					const wpMatch = path.match( /(\/(?:wp-[^/]+\.php|wp-content|wp-includes|wp-admin).*)$/ );
					if ( wpMatch ) {
						return `${ prefix }/wordpress${ wpMatch[ 1 ] }${ suffix }`;
					}
					const fileMatch = path.match( /\/([^/]+\.php)$/ );
					if ( fileMatch ) {
						return `${ prefix }/wordpress/${ fileMatch[ 1 ] }${ suffix }`;
					}
				}
				return match;
			}
		);

		// Also handle direct file references and string concatenations
		modifiedCode = modifiedCode.replace(
			/(['"])([^'"]*\/(?:wp-[^/]*|[^/]+\.php|wp-content|wp-includes|wp-admin)[^'"]*)(['"])/g,
			( match, quote1, path, quote2 ) => {
				// Don't modify phar:// paths
				if ( path.startsWith( 'phar://' ) ) {
					return match;
				}

				if ( path.startsWith( '/wordpress' ) || ! path.startsWith( '/' ) ) {
					return match;
				}
				const wpMatch = path.match( /(\/(?:wp-[^/]+\.php|wp-content|wp-includes|wp-admin).*)$/ );
				if ( wpMatch ) {
					return `${ quote1 }/wordpress${ wpMatch[ 1 ] }${ quote2 }`;
				}
				const fileMatch = path.match( /\/([^/]+\.php)$/ );
				if ( fileMatch ) {
					return `${ quote1 }/wordpress/${ fileMatch[ 1 ] }${ quote2 }`;
				}
				return match;
			}
		);

		const runOptions: PHPRunOptions = {
			code: modifiedCode,
		};

		if ( options.scriptPath ) {
			runOptions.scriptPath = options.scriptPath;
		}

		const response = await server.playground.run( runOptions );

		return response.text || '';
	} catch ( error ) {
		throw new Error( `Failed to run PHP code: ${ error }` );
	}
}
