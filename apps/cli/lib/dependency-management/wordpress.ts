import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { getWordPressVersionUrl } from '@studio/common/lib/wordpress-version-utils';
import { getWordPressVersionPath } from './paths';

const DEFAULT_WORDPRESS_VERSION = 'latest';

export async function downloadWordPress(
	wordPressVersion = DEFAULT_WORDPRESS_VERSION,
	overwrite = false
): Promise< void > {
	const finalFolder = getWordPressVersionPath( wordPressVersion );

	if ( ! overwrite && fs.existsSync( finalFolder ) ) {
		return;
	}

	const tempDir = path.join( os.tmpdir(), 'wordpress-download-', crypto.randomUUID() );
	await fs.promises.mkdir( tempDir, { recursive: true } );

	try {
		const tmpDownloadPath = path.join( os.tmpdir(), `wordpress-${ crypto.randomUUID() }.zip` );

		try {
			await downloadFile( getWordPressVersionUrl( wordPressVersion ), tmpDownloadPath );
			await extractZip( tmpDownloadPath, tempDir );
		} finally {
			await fs.promises.rm( tmpDownloadPath, { force: true } );
		}

		const wpSourcePath = path.join( tempDir, 'wordpress' );
		await fs.promises.mkdir( path.dirname( finalFolder ), { recursive: true } );
		await fs.promises.cp( wpSourcePath, finalFolder, {
			recursive: true,
			verbatimSymlinks: true,
		} );
	} finally {
		try {
			await fs.promises.rm( tempDir, { force: true, recursive: true } );
		} catch {
			// Do nothing
		}
	}
}

/**
 * Throws when the current release can't be determined. Callers must not treat
 * an unreachable wordpress.org as "the cached copy is fine" — that silently
 * hands a stale WordPress to a site the user asked to keep auto-updated.
 */
async function fetchLatestWordPressVersion(): Promise< string > {
	const response = await fetch( 'https://api.wordpress.org/core/stable-check/1.0/' );
	const versionsStatus: Record< string, string > = await response.json();
	const latestVersion = Object.keys( versionsStatus ).find(
		( index ) => versionsStatus[ index ] === 'latest'
	);

	if ( ! latestVersion ) {
		throw new Error( 'wordpress.org did not report a latest WordPress version' );
	}

	return latestVersion;
}

export async function getWordPressVersionFromInstallation( installationPath: string ) {
	try {
		const versionFileContent = await fs.promises.readFile(
			path.join( installationPath, 'wp-includes', 'version.php' ),
			'utf8'
		);
		const matches = versionFileContent.match( /\$wp_version\s*=\s*'([0-9a-zA-Z.-]+)'/ );
		return matches?.[ 1 ];
	} catch ( err ) {
		return null;
	}
}

export async function updateLatestWordPressVersion() {
	let shouldOverwrite = false;

	const latestVersionPath = getWordPressVersionPath( 'latest' );
	const latestVersionFiles = fs.existsSync( latestVersionPath )
		? await fs.promises.readdir( latestVersionPath )
		: [];

	if ( latestVersionFiles.length !== 0 ) {
		const installedVersion = await getWordPressVersionFromInstallation( latestVersionPath );

		const latestVersion = await fetchLatestWordPressVersion();

		if ( installedVersion && installedVersion !== latestVersion ) {
			// We keep a copy of the latest installed version instead of removing it.
			await recursiveCopyDirectory(
				latestVersionPath,
				getWordPressVersionPath( installedVersion )
			);
			shouldOverwrite = true;
		}
	}

	await downloadWordPress( 'latest', shouldOverwrite );
}
