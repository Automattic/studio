import fs from 'node:fs/promises';
import path from 'node:path';
import { openBlueprintFile } from '@studio/blueprints/node';
import { __ } from '@wordpress/i18n';
import type { Blueprint } from '@studio/blueprints';

/** Reads the Blueprint a picked file or folder holds, or null for a folder without one. */
export async function readBlueprintSource( sourcePath: string ): Promise< Blueprint | null > {
	const stats = await fs.stat( sourcePath );
	if ( stats.isDirectory() ) {
		const hasBlueprint = await fs.stat( path.join( sourcePath, 'blueprint.json' ) ).then(
			( stat ) => stat.isFile(),
			() => false
		);
		if ( ! hasBlueprint ) {
			return null;
		}
	} else if ( ! /\.(json|zip)$/i.test( sourcePath ) ) {
		throw new Error(
			__( 'Choose a WordPress site folder, a Blueprint JSON file or a ZIP bundle.' )
		);
	}
	await using opened = await openBlueprintFile( sourcePath );
	return opened.blueprint;
}
