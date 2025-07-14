import { net } from 'electron';
import { pathExists, recursiveCopyDirectory, isEmptyDir } from 'src/lib/fs-utils';
import { verifyWordPressChecksums, purgeWpConfig } from 'src/lib/wp-versions';
import { copyBundledLatestWPVersion } from 'src/setup-wp-server-files';
import { getWordPressVersionPath, downloadWordPress } from 'vendor/wp-now/src/download';
import type { WordPressProvider } from './types';

export class WpNowProvider implements WordPressProvider {
	async setupWordPressSite( path: string, wpVersion = 'latest' ): Promise< boolean > {
		try {
			if ( ( await pathExists( path ) ) && ! ( await isEmptyDir( path ) ) ) {
				// We can only create into a clean directory
				return false;
			}

			const wpVersionPath = getWordPressVersionPath( wpVersion );
			const wpVersionExists = await pathExists( wpVersionPath );

			if ( ! wpVersionExists ) {
				if ( net.isOnline() ) {
					try {
						await downloadWordPress( wpVersion, { overwrite: false } );
					} catch ( error ) {
						console.error( `Failed to download WordPress version ${ wpVersion }:`, error );
						throw new Error(
							`Failed to download WordPress version ${ wpVersion }. Please try a different version.`
						);
					}
				} else if ( wpVersion === 'latest' ) {
					await copyBundledLatestWPVersion();
				} else {
					return false;
				}
			}

			await verifyWordPressChecksums( wpVersion );
			await purgeWpConfig( wpVersion );
			await recursiveCopyDirectory( getWordPressVersionPath( wpVersion ), path );

			return true;
		} catch ( error ) {
			console.error( 'Error in setupWordPressSite:', error );
			throw error;
		}
	}
}
