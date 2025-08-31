import os from 'os';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { createStoragePaths } from 'common/lib/storage-paths';
import { LoggerError } from 'cli/logger';

export const storagePaths = createStoragePaths(
	process.platform === 'win32'
		? process.env.APPDATA ||
				( () => {
					throw new LoggerError( __( 'Studio config file path not found.' ) );
				} )()
		: path.join( os.homedir(), 'Library', 'Application Support' ),
	'Studio',
	// CLI resources path - TBD when we need it for WordPress setup
	''
);
