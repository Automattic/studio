import { SupportedPHPVersion, PHPRunOptions } from '@php-wasm/universal';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
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

async function setSiteOptionsViaPHP(
	server: RunCLIServer,
	serverOptions: WordPressServerOptions
): Promise< void > {
	const phpCode = `<?php
		require_once( '/wordpress/wp-load.php' );

		// Set site title if provided (wp-now doesn't do this post-install, but it's the correct way)
		${
			serverOptions.siteTitle
				? `update_option( 'blogname', '${ serverOptions.siteTitle.replace( /'/g, "\\'" ) }' );`
				: ''
		}

		// Set admin password
		${
			serverOptions.adminPassword
				? `
		$user = get_user_by( 'login', 'admin' );
		if ( $user ) {
			wp_set_password( '${ serverOptions.adminPassword.replace( /'/g, "\\'" ) }', $user->ID );
		} else {
			$user_data = array(
				'user_login' => 'admin',
				'user_pass' => '${ serverOptions.adminPassword.replace( /'/g, "\\'" ) }',
				'user_email' => 'admin@localhost.com',
				'role' => 'administrator',
			);
			$user_id = wp_insert_user( $user_data );
			$user = get_user_by( 'id', $user_id );
		}
		`
				: ''
		}

		echo "Site options updated successfully";
	?>`;

	const response = await server.playground.run( {
		code: phpCode,
	} );

	console.log( '[playground-cli-child] Site options PHP result:', response.text );
}

async function startServer(
	options: PlaygroundCliOptions,
	serverOptions: WordPressServerOptions
): Promise< void > {
	if ( server ) {
		console.log( '[playground-cli-child] Server is already running, skipping start' );
		return;
	}

	try {
		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( serverOptions );
		const skipWordPressSetup = ! options.isSetupMode;

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

		if ( options.wpCliPharPath ) {
			mounts.push( {
				hostPath: options.wpCliPharPath,
				vfsPath: '/tmp/wp-cli.phar',
			} );
		}

		const args: RunCLIArgs = {
			command: 'server',
			internalCookieStore: true,
			followSymlinks: true,
			skipWordPressSetup,
			port: options.port,
			login: true,
			'mount-before-install': mounts,
		};

		if ( options.phpVersion ) {
			args.php = options.phpVersion as SupportedPHPVersion;
		}

		if ( serverOptions.wordPressVersion ) {
			args.wp = serverOptions.wordPressVersion;
		}

		server = await runCLI( args );

		if ( serverOptions.siteTitle || serverOptions.adminPassword ) {
			try {
				await setSiteOptionsViaPHP( server, serverOptions );
			} catch ( error ) {
				console.warn( '[playground-cli-child] Failed to set site options via PHP:', error );
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
		// Don't re-throw the error, just continue cleanup
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
