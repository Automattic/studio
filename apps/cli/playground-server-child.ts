/**
 * Playground runtime stub.
 *
 * This experimental build of the Studio CLI no longer bundles
 * `@wp-playground/*` or `@php-wasm/*` dependencies. Sites configured with
 * `runtime: 'playground'` therefore cannot start. New sites always pick
 * `native-php` (see `resolveRuntimeFromEnv` in commands/site/create.ts), so
 * the only way to hit this entry point is to have a pre-existing site that
 * was created with the Playground runtime in a previous Studio install.
 */

const unavailableMessage =
	'The Playground runtime is not available in this experimental build. ' +
	'Recreate the site or set STUDIO_RUNTIME=native-php.';

process.stderr.write( `[playground-server-child] ${ unavailableMessage }\n` );

if ( typeof process.send === 'function' ) {
	process.send( {
		topic: 'error',
		originalMessageId: 'startup',
		errorMessage: unavailableMessage,
	} );
}

process.exit( 1 );

// Ensure this file is treated as a module (the Vite/TS build entry expects it).
export {};
