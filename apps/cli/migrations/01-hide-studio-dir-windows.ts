/**
 * Hides the `~/.studio` directory on Windows by setting the "hidden" file attribute.
 *
 * On macOS and Linux, directories starting with `.` are hidden by convention.
 * On Windows, directories need the explicit "hidden" attribute set via `attrib +H`.
 */

import fs from 'node:fs';
import {
	hideDirectoryOnWindows,
	isDirectoryHiddenOnWindows,
} from '@studio/common/lib/hide-dir-windows';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import type { Migration } from '@studio/common/lib/migration';

export const hideStudioDirWindows: Migration = {
	needsToRun: async () => {
		if ( process.platform !== 'win32' ) {
			return false;
		}
		const configDir = getConfigDirectory();
		if ( ! fs.existsSync( configDir ) ) {
			return false;
		}
		return ! ( await isDirectoryHiddenOnWindows( configDir ) );
	},
	run: async () => {
		await hideDirectoryOnWindows( getConfigDirectory() );
	},
};
