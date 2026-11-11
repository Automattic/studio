import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const root = path.resolve( import.meta.dirname, '..' );

function manifests( folder ) {
	return readdirSync( path.join( root, folder ), { withFileTypes: true } )
		.filter( ( entry ) => entry.isDirectory() )
		.map( ( entry ) => path.join( folder, entry.name, 'package.json' ) )
		.flatMap( ( file ) => {
			try {
				return [ { file, json: JSON.parse( readFileSync( path.join( root, file ), 'utf8' ) ) } ];
			} catch {
				return [];
			}
		} );
}

// The apps bundle the workspace packages, except for the dependencies an app
// lists itself: those it ships as they are, with its own range. A package and
// an app that both depend on something at runtime use the same range, so what
// ships is what the package was built and tested against.
it( 'gives the packages and the apps the same range for a dependency they share', () => {
	const apps = manifests( 'apps' );
	const mismatches = manifests( 'packages' ).flatMap( ( pkg ) =>
		Object.entries( pkg.json.dependencies ?? {} )
			.filter( ( [ , range ] ) => ! range.startsWith( 'file:' ) )
			.flatMap( ( [ name, range ] ) =>
				apps
					.filter(
						( app ) => app.json.dependencies?.[ name ] && app.json.dependencies[ name ] !== range
					)
					.map(
						( app ) =>
							`${ name }: ${ range } in ${ pkg.file }, ${ app.json.dependencies[ name ] } in ${ app.file }`
					)
			)
	);
	expect( mismatches ).toEqual( [] );
} );
