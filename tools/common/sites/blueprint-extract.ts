import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { extractZip } from '@studio/common/lib/extract-zip';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export interface ExtractedBlueprintBundle {
	blueprintJson: BlueprintV1Declaration;
	blueprintJsonPath: string;
	tempDir: string;
}

/**
 * Extract a Blueprint ZIP bundle to a temp directory and return the parsed
 * `blueprint.json`. Shared between the desktop app and the local web server so
 * both handle uploaded Blueprint bundles identically. The caller is responsible
 * for cleaning up `tempDir` (via {@link cleanupBlueprintTempDir}) if it doesn't
 * go on to consume the extracted bundle.
 */
export async function extractBlueprintBundle(
	zipFilePath: string
): Promise< ExtractedBlueprintBundle > {
	const resolvedZipPath = path.resolve( zipFilePath );
	const tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-blueprint-bundle-' ) );

	try {
		await extractZip( resolvedZipPath, tempDir );

		const blueprintJsonPath = path.join( tempDir, 'blueprint.json' );
		try {
			await fs.promises.access( blueprintJsonPath );
		} catch {
			throw new Error(
				__(
					'No blueprint.json found in the ZIP file. Please ensure the ZIP contains a blueprint.json at its root.'
				)
			);
		}

		const fileContents = await fs.promises.readFile( blueprintJsonPath, 'utf-8' );
		const blueprintJson = JSON.parse( fileContents ) as BlueprintV1Declaration;

		return { blueprintJson, blueprintJsonPath, tempDir };
	} catch ( error ) {
		await fs.promises.rm( tempDir, { recursive: true, force: true } );
		throw error;
	}
}

export async function cleanupBlueprintTempDir( tempDir: string ): Promise< void > {
	await fs.promises.rm( tempDir, { recursive: true, force: true } );
}
