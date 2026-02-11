import nodePath from 'path';
import fs from 'fs-extra';

export function getWordPressVersion( wordPressPath: string ) {
	let versionFileContent = '';
	try {
		versionFileContent = fs.readFileSync(
			nodePath.join( wordPressPath, 'wp-includes', 'version.php' ),
			'utf8'
		);
	} catch ( err ) {
		return '-';
	}
	const matches = versionFileContent.match( /\$wp_version\s*=\s*'([0-9a-zA-Z.-]+)'/ );
	return matches?.[ 1 ] || '-';
}
