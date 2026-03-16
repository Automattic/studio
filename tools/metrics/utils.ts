import fs from 'fs';
import path from 'path';

export function median( array ) {
	if ( ! array || ! array.length ) return undefined;

	const numbers = [ ...array ].sort( ( a, b ) => a - b );
	const middleIndex = Math.floor( numbers.length / 2 );

	if ( numbers.length % 2 === 0 ) {
		return ( numbers[ middleIndex - 1 ] + numbers[ middleIndex ] ) / 2;
	}
	return numbers[ middleIndex ];
}

export function getDirSize( dirPath: string ): number {
	let total = 0;
	for ( const entry of fs.readdirSync( dirPath, { withFileTypes: true } ) ) {
		const entryPath = path.join( dirPath, entry.name );
		if ( entry.isDirectory() ) {
			total += getDirSize( entryPath );
		} else if ( entry.isFile() || entry.isSymbolicLink() ) {
			try {
				total += fs.lstatSync( entryPath ).size;
			} catch {
				// Skip entries that can't be stat'd
			}
		}
	}
	return total;
}
