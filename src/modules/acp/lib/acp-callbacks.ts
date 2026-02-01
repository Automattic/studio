/**
 * ACP Callbacks Handler
 *
 * Handles callback requests from ACP agents for file system operations.
 * Compatible with the official ACP SDK's Client interface.
 */

import { promises as fs } from 'fs';
import nodePath from 'path';
import type { AcpCallbackHandler } from './acp-process-manager';

/**
 * Callbacks handler configuration.
 */
interface CallbacksConfig {
	/** Working directory for the site */
	workingDirectory: string;
	/** Whether to allow write operations */
	allowWrites?: boolean;
	/** Blocked paths/patterns */
	blockedPaths?: string[];
}

/**
 * Default blocked paths that should never be accessed.
 */
const DEFAULT_BLOCKED_PATHS = [
	'.git',
	'.env',
	'node_modules',
	'vendor',
	'wp-config.php', // Contains DB credentials
];

/**
 * Create a callbacks handler for ACP agent requests.
 * Returns an AcpCallbackHandler compatible with the SDK.
 */
export function createCallbacksHandler( config: CallbacksConfig ): AcpCallbackHandler {
	const { workingDirectory, allowWrites = true, blockedPaths = DEFAULT_BLOCKED_PATHS } = config;
	const baseDirectory = nodePath.resolve( workingDirectory );

	/**
	 * Validate and resolve a path within the working directory.
	 */
	function resolvePath( requestedPath: string ): string | null {
		// Resolve the path relative to the site root and guard against traversal.
		const resolved = nodePath.resolve( baseDirectory, requestedPath );
		const relativePath = nodePath.relative( baseDirectory, resolved );
		if ( relativePath.startsWith( '..' ) || nodePath.isAbsolute( relativePath ) ) {
			return null;
		}

		// Check against blocked paths
		const normalizedRelativePath = nodePath.normalize( relativePath );
		for ( const blocked of blockedPaths ) {
			const normalizedBlocked = nodePath.normalize( blocked );
			if (
				normalizedRelativePath === normalizedBlocked ||
				normalizedRelativePath.startsWith( normalizedBlocked + nodePath.sep )
			) {
				return null;
			}
		}

		return resolved;
	}

	return {
		/**
		 * Read a text file.
		 */
		async readTextFile( path: string ): Promise< string > {
			const resolvedPath = resolvePath( path );

			if ( ! resolvedPath ) {
				throw new Error( `Access denied: ${ path }` );
			}

			return fs.readFile( resolvedPath, 'utf-8' );
		},

		/**
		 * Write a text file.
		 */
		async writeTextFile( path: string, content: string ): Promise< void > {
			if ( ! allowWrites ) {
				throw new Error( 'Write operations are disabled' );
			}

			const resolvedPath = resolvePath( path );

			if ( ! resolvedPath ) {
				throw new Error( `Access denied: ${ path }` );
			}

			// Ensure parent directory exists
			await fs.mkdir( nodePath.dirname( resolvedPath ), { recursive: true } );
			await fs.writeFile( resolvedPath, content, 'utf-8' );
		},

		/**
		 * Handle permission requests.
		 * Default behavior: auto-approve with first option.
		 */
		async requestPermission(
			_toolCall: unknown,
			_options: Array< { optionId: string; name: string; kind: string } >
		): Promise< { outcome: 'selected' | 'cancelled'; optionId?: string } > {
			return { outcome: 'cancelled' };
		},
	};
}

/**
 * Create a read-only callbacks handler (no writes).
 */
export function createReadOnlyCallbacksHandler( workingDirectory: string ): AcpCallbackHandler {
	return createCallbacksHandler( {
		workingDirectory,
		allowWrites: false,
	} );
}

/**
 * Create a full-access callbacks handler.
 */
export function createFullAccessCallbacksHandler( workingDirectory: string ): AcpCallbackHandler {
	return createCallbacksHandler( {
		workingDirectory,
		allowWrites: true,
	} );
}
