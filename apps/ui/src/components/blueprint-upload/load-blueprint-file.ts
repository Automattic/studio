import { __ } from '@wordpress/i18n';
import { createSelectedBlueprint } from '@/lib/blueprint-selection';
import type { Connector } from '@/data/core';
import type { SelectedBlueprint } from '@/lib/blueprint-selection';

export const BLUEPRINT_FILE_ACCEPT = 'application/json,.json,application/zip,.zip';

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
			__( 'That file type is not supported. Choose a Blueprint JSON file or ZIP bundle.' )
		);
	}

	const extracted = await connector.extractBlueprintBundle( file ).catch( () => {
		throw new Error(
			__(
				'This ZIP could not be used. Make sure it contains a valid blueprint.json file at the top level and try again.'
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
