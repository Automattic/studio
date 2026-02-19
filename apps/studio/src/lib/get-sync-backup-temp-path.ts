import { app } from 'electron';
import nodePath from 'path';

export function getSyncBackupTempPath( remoteSiteId: number ) {
	const tmpDir = nodePath.join( app.getPath( 'temp' ), 'wp-studio-backups' );
	return nodePath.join( tmpDir, `site-${ remoteSiteId }-backup.tar.gz` );
}
