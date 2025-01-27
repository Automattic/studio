import path from 'path';
import { SQLITE_FILENAME } from './constants';
import getWpNowPath from './get-wp-now-path';

/**
 * The full path to the "SQLite database integration" folder.
 */
export default function getSqlitePath() {
	return path.join( getWpNowPath(), `${ SQLITE_FILENAME }` );
}
