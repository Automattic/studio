/**
 * Removes fs-ext-extra-prebuilt binaries that don't match the current platform.
 *
 * The package ships prebuilt .node files for all platforms. Downstream tools
 * such as Windows code-signing will fail if they encounter binaries built for
 * another OS (e.g. darwin .node files on a Windows build agent). This script
 * is called from both the root postinstall hook and from apps/studio's
 * install:bundle script, so it resolves the binaries directory relative to
 * process.cwd() to work correctly in both contexts.
 */

import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const binDir = join( process.cwd(), 'node_modules', 'fs-ext-extra-prebuilt', 'binaries' );

try {
	for ( const file of readdirSync( binDir ) ) {
		if ( ! file.startsWith( `fs-ext-${ process.platform }-` ) ) {
			try {
				unlinkSync( join( binDir, file ) );
				console.log( `Removed ${ file }` );
			} catch ( e ) {
				console.log( `Could not remove ${ file }: ${ e.message }` );
			}
		}
	}
} catch ( e ) {
	console.log( `Could not clean fs-ext-extra-prebuilt binaries: ${ e.message }` );
}
