import { execFileSync } from 'child_process';

export function removeMacQuarantine( filePath: string, platform = process.platform ): void {
	if ( platform !== 'darwin' ) {
		return;
	}

	try {
		execFileSync( 'xattr', [ '-d', 'com.apple.quarantine', filePath ], {
			stdio: 'ignore',
		} );
	} catch {
		// The attribute is absent on normal app downloads. Ignore that case.
	}
}
