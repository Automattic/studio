// Thin CLI shim so the Studio agent (which cannot consume MCP servers) can
// invoke the html-to-blocks engine as a child process. Usage:
//   node run-tool.mjs <toolName> <argsJsonFilePath>
// Reads args from the given file (argv, not stdin, so the importing of
// mcp-server.mjs — which attaches a dormant stdin listener — does not race
// with our input). Prints a single JSON line to stdout: {ok, result|error}.
import fs from 'node:fs';
import { handlers } from './mcp-server.mjs';

const toolName = process.argv[2];
const argsPath = process.argv[3];

function emit( payload, code = 0 ) {
	// Write then exit in the flush callback so stdout is fully delivered
	// before the process tears down (process.exit can truncate otherwise).
	process.stdout.write( JSON.stringify( payload ), () => process.exit( code ) );
}

( async () => {
	try {
		if ( ! toolName || ! handlers[ toolName ] ) {
			return emit( { ok: false, error: `Unknown engine tool: ${ toolName }` } );
		}
		const args =
			argsPath && fs.existsSync( argsPath )
				? JSON.parse( fs.readFileSync( argsPath, 'utf8' ) )
				: {};
		const result = await handlers[ toolName ]( args );
		emit( { ok: true, result } );
	} catch ( error ) {
		emit( {
			ok: false,
			error: error instanceof Error ? error.stack || error.message : String( error ),
		} );
	}
} )();
