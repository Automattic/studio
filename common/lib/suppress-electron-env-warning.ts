export function suppressElectronEnvWarning() {
	// Save existing listeners
	const originalListeners = process.listeners( 'warning' );

	// Remove all current listeners
	process.removeAllListeners( 'warning' );

	// Add custom listener with filter
	process.on( 'warning', ( warning: Error ) => {
		// Suppress the Electron warning about environment variables when running as Node.js
		// This is safe because the CLI is designed to run with ELECTRON_RUN_AS_NODE=1
		if (
			warning.message?.includes( 'Node.js environment variables are disabled' ) ||
			warning.message?.includes( 'ELECTRON_RUN_AS_NODE' )
		) {
			return;
		}
		// Otherwise, call original listeners (print warning as usual)
		for ( const listener of originalListeners ) {
			listener.call( process, warning );
		}
	} );
}
