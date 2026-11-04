import { __ } from '@wordpress/i18n';
import { createSelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { Connector } from '@/data/core';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';

export class MissingBlueprintError extends Error {}

export function isBlueprintFile( file: File ): boolean {
	return (
		/\.(zip|json)$/i.test( file.name ) ||
		file.type === 'application/zip' ||
		file.type === 'application/json'
	);
}

export async function loadBlueprintFile(
	file: File,
	connector: Connector
): Promise< SelectedBlueprint > {
	const lowerName = file.name.toLowerCase();
	const isJson = file.type === 'application/json' || lowerName.endsWith( '.json' );
	const isZip = file.type === 'application/zip' || lowerName.endsWith( '.zip' );

	if ( isJson ) {
		let parsed: unknown;
		try {
			parsed = JSON.parse( await file.text() );
		} catch {
			throw new Error(
				__(
					'This Blueprint JSON file could not be read. Check that it contains valid JSON and try again.'
				)
			);
		}
		return createSelectedBlueprint( parsed, file );
	}

	if ( ! isZip ) {
		throw new Error(
			__(
				'That file type is not supported. Choose a Blueprint, WordPress backup, or XML export file.'
			)
		);
	}

	const extracted = await connector.extractBlueprintBundle( file ).catch( ( error: unknown ) => {
		if (
			error instanceof Error &&
			error.message.includes( 'No blueprint.json found in the ZIP.' )
		) {
			throw new MissingBlueprintError( error.message );
		}
		throw new Error(
			__(
				'This ZIP could not be used. Make sure it contains a valid blueprint.json file at the top level or inside one enclosing folder, and try again.'
			)
		);
	} );
	try {
		return await createSelectedBlueprint( extracted.blueprintJson, file, {
			filePath: extracted.blueprintJsonPath,
			tempDir: extracted.tempDir,
		} );
	} catch ( error ) {
		await connector.cleanupBlueprintTempDir( extracted.tempDir ).catch( () => undefined );
		throw error;
	}
}
