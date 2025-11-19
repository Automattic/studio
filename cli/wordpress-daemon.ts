/**
 * WordPress Studio Server Daemon
 *
 * This daemon is managed by PM2 and runs a single WordPress site server
 * using the Playground CLI provider. Each site runs in its own PM2 process.
 *
 * Similar to Studio's playground-server-process-child.ts, this daemon:
 * - Listens for messages from the parent process (PM2)
 * - Starts WordPress server when requested
 * - Sends response back when ready
 */
import { SupportedPHPVersion } from '@php-wasm/universal';
import { Blueprint } from '@wp-playground/blueprints';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import { isWordPressDirectory } from 'common/lib/fs-utils';
import { getMuPlugins } from 'src/lib/wordpress-provider/playground-cli/mu-plugins';
import { isWordPressDevVersion } from 'src/lib/wordpress-version-utils';

interface ServerConfig {
	siteId: string;
	sitePath: string;
	port: number;
	phpVersion?: string;
	wpVersion?: string;
	absoluteUrl?: string;
	adminPassword?: string;
	siteTitle?: string;
	siteLanguage?: string;
	isWpAutoUpdating?: boolean;
	blueprint?: Blueprint;
}

type Message = {
	id?: number;
	type: string;
	data?: {
		config?: ServerConfig;
	};
};

let server: RunCLIServer | null = null;
let messageId = 0;

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
		console.log( `[WordPress Daemon] Server already running for site ${ config.siteId }` );
		return;
	}

	try {
		console.log( `[WordPress Daemon] Starting WordPress server for site ${ config.siteId }...` );
		console.log( `[WordPress Daemon] Path: ${ config.sitePath }` );
		console.log( `[WordPress Daemon] Port: ${ config.port }` );
		console.log( `[WordPress Daemon] PHP: ${ config.phpVersion || '8.3' }` );

		const hasWordPress = isWordPressDirectory( config.sitePath );

		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
			projectPath: config.sitePath,
			isSetupMode: false,
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
			skipWordPressSetup: hasWordPress,
		};

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

		console.log( `[WordPress Daemon] Initializing Playground CLI...` );
		server = await runCLI( args );

		if ( config.adminPassword ) {
			console.log( `[WordPress Daemon] Setting admin password...` );
			await setAdminPassword( server, config.adminPassword );
		}

		console.log( `[WordPress Daemon] WordPress server started successfully` );
		console.log( `[WordPress Daemon] URL: http://localhost:${ config.port }` );
	} catch ( error ) {
		server = null;
		console.error( `[WordPress Daemon] Failed to start server:`, error );
		throw error;
	}
}

async function stopServerFunc(): Promise< void > {
	if ( ! server ) {
		return;
	}

	console.log( '[WordPress Daemon] Stopping WordPress server...' );

	const serverToDispose = server;
	server = null;

	try {
		const disposalTimeout = new Promise( ( _, reject ) =>
			setTimeout( () => reject( new Error( 'Disposal timeout' ) ), 5000 )
		);

		await Promise.race( [ serverToDispose[ Symbol.asyncDispose ](), disposalTimeout ] );
		console.log( '[WordPress Daemon] Server stopped successfully' );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		if ( ! errorMessage.includes( 'Cannot read properties of undefined' ) ) {
			console.warn( '[WordPress Daemon] Error during server disposal:', error );
		}
	} finally {
		server = null;
	}
}

// Listen for messages from parent process (similar to Studio's pattern)
if ( process.send ) {
	process.on( 'message', async ( packet: any ) => {
		try {
			// PM2 wraps messages in {type: 'process:msg', data: actualMessage}
			// Unwrap it if needed
			const message: Message = packet.type === 'process:msg' && packet.data ? packet.data : packet;

			let result: unknown;

			switch ( message.type ) {
				case 'start-server':
					if ( message.data?.config ) {
						result = await startServer( message.data.config );
					}
					break;
				case 'stop-server':
					result = await stopServerFunc();
					break;
				default:
					throw new Error( `Unknown message type: ${ message.type }` );
			}

			// Send response back to parent
			if ( process.send && message.id !== undefined ) {
				process.send( { id: message.id, result } );
			}
		} catch ( error ) {
			// Send error back to parent
			// Try to get message ID from either wrapped or unwrapped format
			const messageId =
				packet.type === 'process:msg' && packet.data?.id !== undefined
					? packet.data.id
					: packet.id;

			if ( process.send && messageId !== undefined ) {
				process.send( {
					id: messageId,
					error: error instanceof Error ? error.message : String( error ),
					errorStack: error instanceof Error ? error.stack : undefined,
				} );
			}
		}
	} );

	// Signal that daemon is ready to receive messages
	process.send( { type: 'ready' } );
} else {
	// Fallback for direct execution (not via PM2 with IPC)
	async function main() {
		try {
			const configJson = process.env.STUDIO_WORDPRESS_SERVER_CONFIG;

			if ( ! configJson ) {
				throw new Error(
					'STUDIO_WORDPRESS_SERVER_CONFIG environment variable not set. This daemon must be started via PM2 with configuration.'
				);
			}

			const config: ServerConfig = JSON.parse( configJson );

			await startServer( config );

			// Keep the process alive
			process.on( 'SIGTERM', async () => {
				console.log( `[WordPress Daemon] Received SIGTERM, stopping server...` );
				await stopServerFunc();
				process.exit( 0 );
			} );

			process.on( 'SIGINT', async () => {
				console.log( `[WordPress Daemon] Received SIGINT, stopping server...` );
				await stopServerFunc();
				process.exit( 0 );
			} );
		} catch ( error ) {
			console.error( '[WordPress Daemon] Failed to start:', error );
			process.exit( 1 );
		}
	}

	void main();
}
