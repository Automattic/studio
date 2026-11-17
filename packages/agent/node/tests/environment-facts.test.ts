import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { expect, it } from 'vitest';
import { environmentFactsFor } from '@studio/agent/node/environment-facts';

// A bash whose PATH finds a sed that answers --version as GNU sed does, or
// fails as BSD sed does.
function shellWithSed( versionExit: number ) {
	const dir = mkdtempSync( path.join( os.tmpdir(), 'shell-' ) );
	const script = ( name: string, body: string ) => {
		writeFileSync( path.join( dir, name ), `#!/bin/bash\n${ body }\n` );
		chmodSync( path.join( dir, name ), 0o755 );
	};
	script( 'sed', versionExit ? 'exit 1' : 'echo "sed (GNU sed) 4.9"' );
	script( 'bash', `PATH="${ dir }:$PATH" exec /bin/bash "$@"` );
	return { shell: path.join( dir, 'bash' ), args: [ '-c' ] };
}

it.skipIf( process.platform === 'win32' ).each( [
	{ versionExit: 0, tools: 'the GNU versions of sed, grep and cat.' },
	{
		versionExit: 1,
		tools:
			"the BSD versions of sed, grep and cat: `sed -i` takes a backup suffix (`sed -i ''` for none).",
	},
] )( 'states which versions of the tools the shell runs: $tools', ( { versionExit, tools } ) => {
	const shell = shellWithSed( versionExit );
	const [ fact ] = environmentFactsFor( shell );
	expect( fact ).toMatch(
		new RegExp(
			`^This computer runs .+ \\(${ os.arch() }\\)\\. Bash commands run in ${
				shell.shell
			} \\d+\\.\\d+, with `
		)
	);
	expect( fact.endsWith( tools ) ).toBe( true );
} );
