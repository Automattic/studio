import path from 'path';
import getWpCliTmpPath from './get-wp-cli-tmp-path';
import { getServerFilesPath } from '../../../src/storage/paths';

/**
 * The path for wp-cli phar file within the WP Now folder.
 */
export default function getWpCliPath() {
	if ( process.env.NODE_ENV !== 'test' ) {
		return path.join( getServerFilesPath(), 'wp-cli.phar' );
	}
	return path.join( getWpCliTmpPath(), 'wp-cli.phar' );
}
