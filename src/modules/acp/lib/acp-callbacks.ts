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
	const {
		workingDirectory,
		allowWrites = true,
		blockedPaths = DEFAULT_BLOCKED_PATHS,
	} = config;

	/**
	 * Validate and resolve a path within the working directory.
	 */
	function resolvePath( requestedPath: string ): string | null {
		// Resolve the path relative to working directory
		const resolved = nodePath.resolve( workingDirectory, requestedPath );

		// Ensure the path is within the working directory
		if ( ! resolved.startsWith( workingDirectory ) ) {
			return null;
		}

		// Check against blocked paths
		const relativePath = nodePath.relative( workingDirectory, resolved );
		for ( const blocked of blockedPaths ) {
			if ( relativePath === blocked || relativePath.startsWith( blocked + nodePath.sep ) ) {
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
			options: Array< { optionId: string; name: string; kind: string } >
		): Promise< { outcome: 'selected' | 'cancelled'; optionId?: string } > {
			// Auto-approve with the first "allow" option if available
			const allowOption = options.find(
				( opt ) => opt.kind === 'allow_once' || opt.kind === 'allow_always'
			);

			if ( allowOption ) {
				return {
					outcome: 'selected',
					optionId: allowOption.optionId,
				};
			}

			// Otherwise use first option
			if ( options.length > 0 ) {
				return {
					outcome: 'selected',
					optionId: options[ 0 ].optionId,
				};
			}

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
