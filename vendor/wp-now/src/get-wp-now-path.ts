import getWpNowTmpPath from './get-wp-now-tmp-path';
import { getServerFilesPath } from '../../../src/storage/paths';

export default function getWpNowPath() {
	if (process.env.NODE_ENV !== 'test') {
		return getServerFilesPath()
	}

	return getWpNowTmpPath();
}
