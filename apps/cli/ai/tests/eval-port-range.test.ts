import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// A file URL: an import of a bare Windows path (C:\...) reads its drive as a URL scheme.
const module = JSON.stringify(
	pathToFileURL( path.resolve( import.meta.dirname, '../eval-port-range.ts' ) ).href
);

// Each claim runs in a process of its own, as each eval case does; `held`
// ports are listened on first, as a running case listens on them.
function claim( claims: number, holdFor = 1000 ): Promise< string[] > {
	const script = `
		import { claimPortRange } from ${ module };
		console.log( await claimPortRange() );
		setTimeout( () => {}, ${ holdFor } );
	`;
	return Promise.all(
		Array.from(
			{ length: claims },
			() =>
				new Promise< string >( ( resolve ) => {
					const child = spawn(
						process.execPath,
						[ '--experimental-strip-types', '--input-type=module', '-e', script ],
						{ stdio: [ 'ignore', 'pipe', 'inherit' ] }
					);
					let out = '';
					child.stdout.on( 'data', ( data ) => ( out += data ) );
					child.on( 'exit', () => resolve( out.trim() ) );
				} )
		)
	);
}

describe( 'claimPortRange', () => {
	it( 'gives processes claiming at once ranges of their own', async () => {
		expect( ( await claim( 4 ) ).sort() ).toEqual( [ '20000', '20100', '20200', '20300' ] );
	} );

	it( 'gives a range back when its process ends', async () => {
		expect( await claim( 1, 0 ) ).toEqual( [ '20000' ] );
		expect( await claim( 1, 0 ) ).toEqual( [ '20000' ] );
	} );

	it( 'passes over a range whose port something else listens on', async () => {
		const other = net.createServer();
		await new Promise< void >( ( resolve ) => other.listen( 19900, '127.0.0.1', resolve ) );
		try {
			expect( await claim( 1 ) ).toEqual( [ '20100' ] );
		} finally {
			other.close();
		}
	} );
} );
