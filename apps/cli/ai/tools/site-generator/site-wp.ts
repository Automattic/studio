import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';

/**
 * Thin WP-CLI helpers for the generation tools. Unlike the `wp_cli` agent tool
 * (which parses a shell-ish string and connects per call), the generation
 * pipeline issues many commands with already-split argv, so it connects to the
 * daemon once via `withDaemon` and reuses the connection.
 */

export interface WpCliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export async function withDaemon< T >( fn: () => Promise< T > ): Promise< T > {
	await connectToDaemon();
	try {
		return await fn();
	} finally {
		await disconnectFromDaemon();
	}
}

export async function isSiteRunning( siteId: string ): Promise< boolean > {
	return Boolean( await isServerRunning( siteId ) );
}

export async function wpCli( siteId: string, args: string[] ): Promise< WpCliResult > {
	const result = await sendWpCliCommand( siteId, args );
	return {
		exitCode: result.exitCode,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}
