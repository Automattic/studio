import path from 'path';
import getWpCliTmpPath from './get-wp-cli-tmp-path';
import { getServerFilesPath } from '../../../src/storage/paths';

/**
 * The path to the wp-cli folder within the WP Now folder.
 */
export function getWpCliFolderPath() {
	if ( process.env.NODE_ENV !== 'test' ) {
		return path.join( getServerFilesPath() );
	}
	return path.join( getWpCliTmpPath() );
}

/**
 * The path for wp-cli phar file within the WP Now folder.
 */
export default function getWpCliPath() {
	return path.join( getWpCliFolderPath(), 'wp-cli.phar' );
}
