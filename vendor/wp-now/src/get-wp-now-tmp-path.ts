import os from 'os';
import path from 'path';

/**
 * The full path to the hidden WP Now folder in the user's tmp directory.
 */
export default function getWpNowTmpPath() {
	const tmpDirectory = os.tmpdir();
	return path.join( tmpDirectory, `wp-now-tests-hidden-folder` );
}
