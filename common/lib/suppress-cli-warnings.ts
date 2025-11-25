/**
 * Suppresses known CLI warnings that are not relevant to end users.
 * This includes:
 * - Electron environment variable warning (ELECTRON_RUN_AS_NODE)
 * - Punycode deprecation warning (DEP0040)
 */
export function suppressCliWarnings() {
	// Save existing listeners
	const originalListeners = process.listeners( 'warning' );

	// Remove all current listeners
	process.removeAllListeners( 'warning' );

	// Add custom listener with filter
	process.on( 'warning', ( warning: Error & { code?: string } ) => {
		// Suppress the Electron warning about environment variables when running as Node.js
		// This is safe because the CLI is designed to run with ELECTRON_RUN_AS_NODE=1
		if (
			warning.message?.includes( 'Node.js environment variables are disabled' ) ||
			warning.message?.includes( 'ELECTRON_RUN_AS_NODE' )
		) {
			return;
		}

		// Suppress only the punycode deprecation warning
		if ( warning.name === 'DeprecationWarning' && warning.code === 'DEP0040' ) {
			return;
		}

		// Otherwise, call original listeners (print warning as usual)
		for ( const listener of originalListeners ) {
			listener.call( process, warning );
		}
	} );
}
