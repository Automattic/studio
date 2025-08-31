import path from 'path';
import { storagePaths } from '../../../src/storage/paths';
import getWpCliTmpPath from './get-wp-cli-tmp-path';

/**
 * The path to the wp-cli folder within the WP Now folder.
 */
export function getWpCliFolderPath() {
	if ( process.env.NODE_ENV !== 'test' ) {
		return path.join( storagePaths.getServerFilesPath() );
	}
	return path.join( getWpCliTmpPath() );
}

/**
 * The path for wp-cli phar file within the WP Now folder.
 */
export default function getWpCliPath() {
	return path.join( getWpCliFolderPath(), 'wp-cli.phar' );
}
