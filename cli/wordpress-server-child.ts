/**
 * WordPress Studio Server Child Process
 *
 * This child process is managed by PM2 and runs a single WordPress site server
 * using the Playground CLI provider. Each site runs in its own PM2 process.
 *
 * Similar to Studio's playground-server-process-child.ts, this process:
 * - Listens for messages from the parent process (PM2)
 * - Starts WordPress server when requested
 * - Sends response back when ready
 * - Sends activity heartbeats to prevent timeout during long operations
 */
import { SupportedPHPVersion } from '@php-wasm/universal';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import { isWordPressDirectory } from 'common/lib/fs-utils';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { isWordPressDevVersion } from 'src/lib/wordpress-version-utils';
import { ServerConfig, Message } from './lib/types/wordpress-server';

let server: RunCLIServer | null = null;

const originalStdoutWrite = process.stdout.write.bind( process.stdout );
const originalStderrWrite = process.stderr.write.bind( process.stderr );

process.stdout.write = function ( ...args: Parameters< typeof originalStdoutWrite > ) {
	if ( process.send ) {
		process.send( { type: 'activity' } );
	}
	return originalStdoutWrite( ...args );
} as typeof process.stdout.write;

process.stderr.write = function ( ...args: Parameters< typeof originalStderrWrite > ) {
	if ( process.send ) {
		process.send( { type: 'activity' } );
	}
	return originalStderrWrite( ...args );
} as typeof process.stderr.write;

function escapePhpString( str: string ): string {
	return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

async function setAdminPassword( server: RunCLIServer, adminPassword: string ): Promise< void > {
	await server.playground.request( {
		url: '/?studio-admin-api',
		method: 'POST',
		body: {
			action: 'set_admin_password',
			password: escapePhpString( adminPassword ),
		},
	} );
}

async function startServer( config: ServerConfig ): Promise< void > {
	if ( server ) {
		console.log( `[WordPress Server Child] Server already running for site ${ config.siteId }` );
		return;
	}

	try {
		const hasWordPress = isWordPressDirectory( config.sitePath );

		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
			isWpAutoUpdating: config.isWpAutoUpdating,
		} );

		const defaultConstants = {
			WP_SQLITE_AST_DRIVER: true,
		};

		const mounts = [
			{
				hostPath: config.sitePath,
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
			command: 'server',
			internalCookieStore: false,
			login: false,
			followSymlinks: true,
			skipSqliteSetup: true,
			port: config.port,
			'mount-before-install': mounts,
			'site-url': config.absoluteUrl || `http://localhost:${ config.port }`,
			blueprint: config.blueprint || {},
			wordpressInstallMode: 'download-and-install',
		};

		if ( hasWordPress ) {
			args.wordpressInstallMode = 'install-from-existing-files-if-needed';
		}

		if ( config.phpVersion ) {
			args.php = config.phpVersion as SupportedPHPVersion;
		}

		if ( config.wpVersion ) {
			if ( isWordPressDevVersion( config.wpVersion ) ) {
				args.wp = 'nightly';
			} else {
				args.wp = config.wpVersion;
			}
		}

		args.blueprint.constants = { ...args.blueprint.constants, ...defaultConstants };
		const server = await runCLI( args );

		if ( ! server ) {
			throw new Error( 'Failed to start server: runCLI returned void' );
		}

		if ( config.adminPassword ) {
			await setAdminPassword( server, config.adminPassword );
		}
	} catch ( error ) {
		server = null;
		console.error( `[WordPress Server Child] Failed to start server:`, error );
		throw error;
	}
}

if ( process.send ) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	process.on( 'message', async ( packet: any ) => {
		try {
			const message: Message = packet.type === 'process:msg' && packet.data ? packet.data : packet;

			let result: unknown;

			switch ( message.type ) {
				case 'start-server':
					if ( message.data?.config ) {
						result = await startServer( message.data.config );
					}
					break;
				default:
					throw new Error( `Unknown message type: ${ message.type }` );
			}

			if ( process.send && message.id !== undefined ) {
				process.send( { id: message.id, result } );
			}
		} catch ( error ) {
			const messageId =
				packet.type === 'process:msg' && packet.data?.id !== undefined ? packet.data.id : packet.id;

			if ( process.send && messageId !== undefined ) {
				process.send( {
					id: messageId,
					error: error instanceof Error ? error.message : String( error ),
					errorStack: error instanceof Error ? error.stack : undefined,
				} );
			}
		}
	} );

	process.send( { type: 'ready' } );
}
