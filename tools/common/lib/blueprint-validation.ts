// Blueprint validation stub.
//
// The original implementation drove an ajv-based JSON-schema validator
// imported from `@wp-playground/blueprints/blueprint-schema-validator`.
// This experimental build no longer ships `@wp-playground/blueprints`, so we
// short-circuit the helper: every blueprint is accepted, and downstream
// runtime errors (from blueprints.phar) surface schema mismatches instead.

export type BlueprintPreferredVersions = {
	php?: string;
	wp?: string;
};

export type BlueprintValidationWarning = {
	message: string;
};

type BlueprintValidationError = {
	valid: false;
	error: string;
};
type BlueprintValidationSuccess = {
	valid: true;
	warnings?: BlueprintValidationWarning[];
};
export type BlueprintValidationResult = BlueprintValidationError | BlueprintValidationSuccess;

export async function validateBlueprintData(
	_blueprintJson: unknown
): Promise< BlueprintValidationResult > {
	return { valid: true };
}
