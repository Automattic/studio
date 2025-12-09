import fs from 'fs';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { Blueprint } from '@wp-playground/blueprints';
import { untildify } from 'cli/lib/utils';
import { LoggerError } from 'cli/logger';

async function fetchBlueprint( url: string ) {
	const res = await fetch( url );

	if ( ! res.ok ) {
		throw new LoggerError( __( 'Failed to fetch blueprint' ) );
	}

	try {
		return await res.json();
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to parse blueprint JSON' ), error );
	}
}

function readBlueprint( blueprintPath: string ) {
	blueprintPath = path.resolve( untildify( blueprintPath ) );

	if ( ! fs.existsSync( blueprintPath ) ) {
		throw new LoggerError( sprintf( __( 'Blueprint file not found: %s' ), blueprintPath ) );
	}

	try {
		const blueprintContent = fs.readFileSync( blueprintPath, 'utf-8' );
		return JSON.parse( blueprintContent );
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse blueprint JSON file: %s' ), blueprintPath ),
			error
		);
	}
}

export async function blueprintCoercer( value: string ): Blueprint {
	let blueprintJson: Blueprint;

	if ( value ) {
		if ( /^https?:\/\//.test( value ) ) {
			blueprintJson = await fetchBlueprint( value );
		} else {
			blueprintJson = readBlueprint( value );
		}
	}

	return blueprintJson;
}
