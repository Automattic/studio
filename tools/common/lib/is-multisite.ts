import fs from 'fs';
import nodePath from 'path';

export function isMultisite( wordPressPath: string ): boolean {
	let configContent = '';
	try {
		configContent = fs.readFileSync( nodePath.join( wordPressPath, 'wp-config.php' ), 'utf8' );
	} catch ( err ) {
		return false;
	}
	return /define\(\s*['"]MULTISITE['"]\s*,\s*true\s*\)/.test( configContent );
}
