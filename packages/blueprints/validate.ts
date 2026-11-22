import { __, sprintf } from '@wordpress/i18n';
import validateBlueprintSchema from '@wp-playground/blueprints/blueprint-schema-validator';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export type Blueprint = BlueprintV1Declaration;

/**
 * Checks `data` against the Blueprint v1 JSON schema and returns it as a Blueprint, or throws
 * with a readable message.
 */
export function validateBlueprint( data: unknown ): Blueprint {
	if ( ( data as { version?: unknown } | null )?.version === 2 ) {
		throw new Error(
			__( 'Blueprint v2 format is not supported yet. Please use Blueprint v1 format.' )
		);
	}
	if ( validateBlueprintSchema( data ) ) {
		return data as Blueprint;
	}

	// The validator is built with ajv v8 (instancePath, additionalProperty) but ships ajv v6 types.
	const error = validateBlueprintSchema.errors?.[ 0 ] as
		| { instancePath?: string; message?: string; params?: { additionalProperty?: string } }
		| undefined;
	const property = error?.params?.additionalProperty;
	const message = property
		? sprintf( __( '"%s" is not a valid Blueprint property' ), property )
		: error?.message || __( 'Invalid blueprint' );
	const errorPath = error?.instancePath || '/';
	throw new Error( errorPath === '/' ? message : `${ message } at ${ errorPath }` );
}
