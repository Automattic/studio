import { __, sprintf } from '@wordpress/i18n';
import validateBlueprintSchema from '@wp-playground/blueprints/blueprint-schema-validator';

export type BlueprintPreferredVersions = {
	php?: string;
	wp?: string;
};

type BlueprintValidationError = {
	valid: false;
	error: string;
};
type BlueprintValidationSuccess = {
	valid: true;
};
export type BlueprintValidationResult = BlueprintValidationError | BlueprintValidationSuccess;

/**
 * Validates a blueprint against the official Blueprint JSON schema.
 */
export async function validateBlueprintData(
	blueprintJson: unknown
): Promise< BlueprintValidationResult > {
	const isValid = validateBlueprintSchema( blueprintJson );

	if ( ! isValid && validateBlueprintSchema.errors ) {
		const firstError = validateBlueprintSchema.errors[ 0 ];
		// The schema validator uses ajv v8 internally (instancePath, additionalProperty)
		// but ships with ajv v6 types (dataPath, ErrorParameters).
		type RuntimeError = { instancePath?: string; params?: { additionalProperty?: string } };
		const error = firstError as unknown as RuntimeError;
		const errorPath = error.instancePath || '/';
		const additionalProp = error.params?.additionalProperty;
		const errorMessage = additionalProp
			? sprintf( __( '"%s" is not a valid Blueprint property' ), additionalProp )
			: firstError.message || __( 'Invalid blueprint' );

		return {
			valid: false,
			error: errorPath === '/' ? errorMessage : `${ errorMessage } at ${ errorPath }`,
		};
	}

	return { valid: true };
}
