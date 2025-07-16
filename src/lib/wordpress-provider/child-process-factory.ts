/**
 * Factory for creating WordPress providers in child processes
 * This module creates providers without Electron dependencies
 */

import type {
	WpCliChildProcessProvider,
	SiteServerChildProcessProvider,
	SiteServerOptions,
	SiteServerInstance,
} from './child-process-types';
import type { PHPRunOptions } from '@php-wasm/universal';

// WP-Now implementation
class WpNowChildProvider implements WpCliChildProcessProvider, SiteServerChildProcessProvider {
	async executeWPCli(
		projectPath: string,
		args: string[],
		options?: { phpVersion?: string }
	): Promise< { stdout: string; stderr: string; exitCode: number } > {
		const { executeWPCli } = await import( 'vendor/wp-now/src/execute-wp-cli' );
		return await executeWPCli( projectPath, args, options );
	}

	async startServer( options: SiteServerOptions ): Promise< SiteServerInstance > {
		const { startServer } = await import( 'vendor/wp-now/src' );

		// The options are already in WPNowOptions format when passed from the main process
		const server = await startServer( options );

		return {
			php: {
				documentRoot: server.php.documentRoot,
				run: async ( request: PHPRunOptions ) => {
					const response = await server.php.run( request );
					return { text: response.text };
				},
			},
			stopServer: () => server.stopServer(),
		};
	}
}

/**
 * Create a provider instance for child processes
 * The provider type is determined by environment variable
 */
export function createChildProcessProvider(): WpCliChildProcessProvider &
	SiteServerChildProcessProvider {
	const providerType = process.env.WORDPRESS_PROVIDER_TYPE || 'wp-now';

	switch ( providerType ) {
		case 'wp-now':
			return new WpNowChildProvider();
		default:
			throw new Error( `Unknown WordPress provider type: ${ providerType }` );
	}
}
