// Deprecation warning codes to suppress:
// DEP0040: The `punycode` module is deprecated
// DEP0049: util.isFunction is deprecated (from @vscode/sudo-prompt)
// DEP0053: util.isObject is deprecated (from @vscode/sudo-prompt)
const SUPPRESSED_DEPRECATION_CODES = [ 'DEP0040', 'DEP0049', 'DEP0053' ];

export function suppressPunycodeWarning() {
	// Save existing listeners
	const originalListeners = process.listeners( 'warning' );

	// Remove all current listeners
	process.removeAllListeners( 'warning' );

	// Add custom listener with filter
	process.on( 'warning', ( warning: Error & { code?: string } ) => {
		if (
			warning.name === 'DeprecationWarning' &&
			warning.code &&
			SUPPRESSED_DEPRECATION_CODES.includes( warning.code )
		) {
			return;
		}
		// Otherwise, call original listeners (print warning as usual)
		for ( const listener of originalListeners ) {
			listener.call( process, warning );
		}
	} );
}
