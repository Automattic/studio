// Adds or removes the links from node_modules to the workspaces, the way npm makes them:
// junctions on Windows, relative symlinks elsewhere. The node_modules cache leaves them out,
// as they point into the checkout.
//
// Usage: node .buildkite/commands/workspace-links.mjs add|remove

import fs from 'node:fs';
import path from 'node:path';

const action = process.argv[ 2 ];
const { packages } = JSON.parse( fs.readFileSync( 'package-lock.json', 'utf8' ) );

for ( const [ location, { link, resolved } ] of Object.entries( packages ) ) {
	if ( ! link ) {
		continue;
	}
	if ( action === 'add' ) {
		fs.mkdirSync( path.dirname( location ), { recursive: true } );
		fs.symlinkSync( path.relative( path.dirname( location ), resolved ), location, 'junction' );
	} else if ( action === 'remove' ) {
		// Removes the link only, never what it points to.
		fs.rmSync( location, { force: true } );
	} else {
		throw new Error( 'Usage: node .buildkite/commands/workspace-links.mjs add|remove' );
	}
}
