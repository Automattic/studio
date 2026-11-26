// Loaded with `--import` (through NODE_OPTIONS) into every Node process `env.mjs` runs as an
// agent, to keep two packages Studio uses off the owner's desktop, whatever HOME and PATH say:
//
// - `trash` moves files to the owner's real Trash; `trash-shim.mjs` deletes them instead.
// - `@vscode/sudo-prompt` runs an AppleScript applet that asks for the owner's password, for
//   custom domains and HTTPS; `sudo-shim.mjs` refuses, as when the owner declines.
//
// Both are caught by name, as the CLI's bundle imports them, and by path, as vitest imports
// them once its resolver has found their files.
import { registerHooks } from 'node:module';

const SHIMS = {
	trash: new URL( './trash-shim.mjs', import.meta.url ).href,
	'@vscode/sudo-prompt': new URL( './sudo-shim.mjs', import.meta.url ).href,
};

function shimFor( url ) {
	return Object.keys( SHIMS ).find( ( name ) => url?.includes( `/node_modules/${ name }/` ) );
}

registerHooks( {
	resolve( specifier, context, nextResolve ) {
		if ( Object.hasOwn( SHIMS, specifier ) ) {
			return { url: SHIMS[ specifier ], format: 'module', shortCircuit: true };
		}
		const result = nextResolve( specifier, context );
		const name = shimFor( result.url );
		// The package's own files import each other; only an import from outside it is replaced.
		if ( name && shimFor( context.parentURL ) !== name ) {
			return { url: SHIMS[ name ], format: 'module', shortCircuit: true };
		}
		return result;
	},
} );
