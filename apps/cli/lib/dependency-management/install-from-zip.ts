import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { extractZip } from '@studio/common/lib/extract-zip';

const RENAME_ATTEMPTS = 5;

// Unpacks the `rootFolder` inside `zipPath` to `target` through a staging directory beside it,
// then renames it into place. Several CLI processes run this at once (the app starts more than
// one), so `target` must only ever appear complete: `isInstalled` is what readers check before
// using it.
export async function installFromZip(
	zipPath: string,
	rootFolder: string,
	target: string,
	isInstalled: ( target: string ) => Promise< boolean >
) {
	const staging = `${ target }.partial-${ process.pid }-${ crypto.randomUUID() }`;
	try {
		await extractZip( zipPath, staging );
		for ( let attempt = 1; ; attempt++ ) {
			try {
				await fs.promises.rename( path.join( staging, rootFolder ), target );
				return;
			} catch ( error ) {
				// Another process installed `target` first, which is as good as our own copy.
				if ( await isInstalled( target ) ) {
					return;
				}
				if ( attempt === RENAME_ATTEMPTS ) {
					throw error;
				}
				// An incomplete `target` left by an interrupted install blocks the rename. Remove it and
				// retry; another process may install its own copy in between, which the check above accepts.
				await fs.promises.rm( target, { recursive: true, force: true } );
				await new Promise( ( resolve ) => setTimeout( resolve, attempt * 200 ) );
			}
		}
	} finally {
		await fs.promises.rm( staging, { recursive: true, force: true } );
	}
}
