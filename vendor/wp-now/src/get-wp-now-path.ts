import { getServerFilesPath } from 'src/storage/paths';
import getWpNowTmpPath from './get-wp-now-tmp-path';

export default function getWpNowPath() {
	if ( process.env.NODE_ENV !== 'test' ) {
		return getServerFilesPath();
	}

	return getWpNowTmpPath();
}
