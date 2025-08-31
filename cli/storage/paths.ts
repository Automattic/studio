import os from 'os';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { createStoragePaths } from 'common/lib/storage-paths';
import { LoggerError } from 'cli/logger';

const appDataPath =
	process.platform === 'win32'
		? process.env.APPDATA ||
		  ( () => {
				throw new LoggerError( __( 'Studio config file path not found.' ) );
		  } )()
		: path.join( os.homedir(), 'Library', 'Application Support' );

const studioDataPath = path.join( appDataPath, 'Studio' );
const cliResourcesPath = path.join( studioDataPath, 'cli-resources' );

export const storagePaths = createStoragePaths( appDataPath, 'Studio', cliResourcesPath );
