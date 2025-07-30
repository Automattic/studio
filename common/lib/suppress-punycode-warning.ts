export function suppressPunycodeWarning() {
	// Save existing listeners
	const originalListeners = process.listeners( 'warning' );

	// Remove all current listeners
	process.removeAllListeners( 'warning' );

	// Add custom listener with filter
	process.on( 'warning', ( warning: Error & { code?: string } ) => {
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
