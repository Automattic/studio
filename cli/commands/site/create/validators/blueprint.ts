import fs from 'fs';
import { __, sprintf } from '@wordpress/i18n';
import { Blueprint } from '@wp-playground/blueprints';
import { LoggerError } from 'cli/logger';

export function blueprintValidator( value: string ): Blueprint {
	let blueprintJson: Blueprint;

	if ( ! fs.existsSync( value ) ) {
		throw new LoggerError( sprintf( __( 'Blueprint file not found: %s' ), value ) );
	}

	try {
		const blueprintContent = fs.readFileSync( value, 'utf-8' );
		blueprintJson = JSON.parse( blueprintContent );
	} catch ( error ) {
		throw new LoggerError( sprintf( __( 'Invalid blueprint JSON file: %s' ), value ), error );
	}

	return blueprintJson;
}
