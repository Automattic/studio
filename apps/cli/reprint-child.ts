/**
 * Reprint runtime stub.
 *
 * The reprint workflow (`studio pull-reprint`) drives `reprint.phar` inside a
 * PHP WASM child. This experimental build does not bundle PHP WASM, so the
 * child immediately reports an error back to the parent and exits.
 */

const unavailableMessage =
	'The reprint workflow is not available in this experimental build (PHP WASM is not bundled).';

process.stderr.write( `[reprint-child] ${ unavailableMessage }\n` );

if ( typeof process.send === 'function' ) {
	process.send( { type: 'error', message: unavailableMessage } );
}

process.exit( 1 );

// Ensure this file is treated as a module (the Vite/TS build entry expects it).
export {};
