import fs from 'node:fs/promises';
import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import { isEmptyDir, isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { readBlueprintSource } from './blueprint-source';

export interface SiteSourceFile {
	path: string;
	name: string;
}

export async function readSiteSource( sourcePath: string ) {
	const stats = await fs.stat( sourcePath );
	const base = { path: sourcePath, name: path.basename( sourcePath ) };
	if ( stats.isDirectory() && isWordPressDirectory( sourcePath ) ) {
		return { ...base, isEmpty: false, isWordPress: true };
	}
	const extension = path.extname( sourcePath ).toLowerCase();
	if ( stats.isDirectory() || extension === '.json' || extension === '.zip' ) {
		try {
			const blueprint = await readBlueprintSource( sourcePath );
			if ( blueprint ) return { ...base, blueprint, isEmpty: false, isWordPress: false };
		} catch ( error ) {
			if (
				extension !== '.zip' ||
				! ( error instanceof Error ) ||
				! error.message.startsWith( 'No blueprint.json found in the ZIP.' )
			)
				throw error;
		}
	}
	if ( stats.isDirectory() ) {
		return { ...base, isEmpty: await isEmptyDir( sourcePath ), isWordPress: false };
	}
	if ( ! isSupportedBackupFilename( base.name ) ) {
		throw new Error( __( 'Choose a blueprint, backup, export, or existing WordPress folder.' ) );
	}
	return { ...base, file: base, isEmpty: false, isWordPress: false };
}
