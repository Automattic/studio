import fs from 'node:fs/promises';
import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { extractBlueprintBundle } from './blueprint-extract';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export interface BlueprintSource {
	blueprintJson: BlueprintV1Declaration;
	blueprintJsonPath: string;
	tempDir?: string;
}

export async function readBlueprintSource( sourcePath: string ): Promise< BlueprintSource | null > {
	const stats = await fs.stat( sourcePath );
	if ( stats.isFile() && path.extname( sourcePath ).toLowerCase() === '.zip' ) {
		return extractBlueprintBundle( sourcePath );
	}
	if ( ! stats.isDirectory() && path.extname( sourcePath ).toLowerCase() !== '.json' ) {
		throw new Error(
			__( 'Choose a WordPress site folder, a Blueprint JSON file or a ZIP bundle.' )
		);
	}
	const blueprintJsonPath = stats.isDirectory()
		? path.join( sourcePath, 'blueprint.json' )
		: sourcePath;
	let contents: string;
	try {
		contents = await fs.readFile( blueprintJsonPath, 'utf8' );
	} catch ( error ) {
		if ( stats.isDirectory() && ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) return null;
		throw error;
	}
	try {
		return { blueprintJson: JSON.parse( contents ), blueprintJsonPath };
	} catch {
		throw new Error(
			__(
				'This Blueprint JSON file could not be read. Check that it contains valid JSON and try again.'
			)
		);
	}
}
