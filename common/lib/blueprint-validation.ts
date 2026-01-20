import { __ } from '@wordpress/i18n';
import validateBlueprintSchema from '@wp-playground/blueprints/blueprint-schema-validator';

interface AjvErrorObject {
	keyword: string;
	instancePath: string;
	message?: string;
	params: Record< string, unknown >;
}

interface UnsupportedFeature {
	type: 'step' | 'property';
	name: string;
	reason: string;
}

/**
 * List of blueprint features that are not supported in Studio
 */
const UNSUPPORTED_BLUEPRINT_FEATURES: UnsupportedFeature[] = [
	{
		type: 'step',
		name: 'enableMultisite',
		reason: __( 'Multisite functionality is not currently supported in Studio.' ),
	},
	{
		type: 'step',
		name: 'login',
		reason: __( 'Studio automatically creates and logs in the admin user during site creation.' ),
	},
	{
		type: 'step',
		name: 'defineSiteUrl',
		reason: __(
			'Custom site URLs in blueprints are ignored. You can set a custom site URL on the Settings tab.'
		),
	},
];

/**
 * Blueprint properties that are not supported in Studio
 */
const UNSUPPORTED_BLUEPRINT_PROPERTIES: UnsupportedFeature[] = [
	{
		type: 'property',
		name: 'landingPage',
		reason: __( 'Studio manages its own navigation and landing pages.' ),
	},
];

function isStepSupported( stepName: string ): boolean {
	return ! UNSUPPORTED_BLUEPRINT_FEATURES.some(
		( feature ) => feature.type === 'step' && feature.name === stepName
	);
}

function isPropertySupported( propertyName: string ): boolean {
	return ! UNSUPPORTED_BLUEPRINT_PROPERTIES.some(
		( feature ) => feature.type === 'property' && feature.name === propertyName
	);
}

function getUnsupportedFeatureInfo( name: string ): UnsupportedFeature | undefined {
	return (
		UNSUPPORTED_BLUEPRINT_FEATURES.find( ( feature ) => feature.name === name ) ||
		UNSUPPORTED_BLUEPRINT_PROPERTIES.find( ( feature ) => feature.name === name )
	);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlueprintData = Record< string, any >;

function formatValidationError( error: AjvErrorObject ): string {
	const path = error.instancePath || '/';

	switch ( error.keyword ) {
		case 'additionalProperties': {
			const additionalProp = error.params?.additionalProperty as string | undefined;
			if ( additionalProp ) {
				return __( `Unknown property "${ additionalProp }" at ${ path || 'root' }` );
			}
			return __( `Unknown property at ${ path || 'root' }` );
		}
		case 'required': {
			const missingProp = error.params?.missingProperty as string | undefined;
			if ( missingProp ) {
				return __( `Missing required property "${ missingProp }" at ${ path || 'root' }` );
			}
			return __( `Missing required property at ${ path || 'root' }` );
		}
		case 'type': {
			const expectedType = error.params?.type as string | undefined;
			if ( expectedType ) {
				return __( `Expected ${ expectedType } at ${ path || 'root' }` );
			}
			return __( `Invalid type at ${ path || 'root' }` );
		}
		case 'enum': {
			const allowedValues = error.params?.allowedValues as string[] | undefined;
			if ( allowedValues ) {
				return __(
					`Invalid value at ${ path || 'root' }. Allowed values: ${ allowedValues.join( ', ' ) }`
				);
			}
			return __( `Invalid value at ${ path || 'root' }` );
		}
		default:
			return error.message || __( 'Invalid Blueprint format' );
	}
}

export type BlueprintPreferredVersions = {
	php?: string;
	wp?: string;
};

export function scanBlueprintForUnsupportedFeatures(
	blueprint: BlueprintData
): UnsupportedFeature[] {
	const foundUnsupported: UnsupportedFeature[] = [];

	if ( blueprint.steps && Array.isArray( blueprint.steps ) ) {
		for ( const step of blueprint.steps ) {
			if ( step.step && ! isStepSupported( step.step ) ) {
				const featureInfo = getUnsupportedFeatureInfo( step.step );
				if ( featureInfo ) {
					foundUnsupported.push( featureInfo );
				}
			}
		}
	}

	for ( const [ key ] of Object.entries( blueprint ) ) {
		if ( ! isPropertySupported( key ) ) {
			const featureInfo = getUnsupportedFeatureInfo( key );
			if ( featureInfo ) {
				foundUnsupported.push( featureInfo );
			}
		}
	}

	return foundUnsupported.filter(
		( feature, index, self ) =>
			index === self.findIndex( ( f ) => f.name === feature.name && f.type === feature.type )
	);
}

export function filterUnsupportedBlueprintFeatures(
	blueprint: BlueprintData | undefined
): BlueprintData | undefined {
	if ( ! blueprint ) {
		return undefined;
	}
	const filtered = { ...blueprint };

	if ( filtered.steps && Array.isArray( filtered.steps ) ) {
		filtered.steps = filtered.steps.filter(
			( step: { step: string } ) => step.step && isStepSupported( step.step )
		);
	}

	for ( const [ key ] of Object.entries( filtered ) ) {
		if ( ! isPropertySupported( key ) ) {
			delete filtered[ key ];
		}
	}

	return filtered;
}

export type BlueprintValidationWarning = {
	feature: string;
	reason: string;
};

type BlueprintValidationError = {
	valid: false;
	error: string;
};
type BlueprintValidationSuccess = {
	valid: true;
	warnings: BlueprintValidationWarning[];
};
export type BlueprintValidationResult = BlueprintValidationError | BlueprintValidationSuccess;

/**
 * Validates a blueprint by compiling it and scanning for unsupported features.
 */
export async function validateBlueprintData(
	blueprintJson: unknown
): Promise< BlueprintValidationResult > {
	// Temporarily suppress console.warn during blueprint validation
	// to avoid noisy deprecation warnings from @wp-playground/blueprints
	const originalWarn = console.warn;
	console.warn = () => {};

	try {
		const isValid = validateBlueprintSchema( blueprintJson );

		if ( ! isValid && validateBlueprintSchema.errors ) {
			const firstError = validateBlueprintSchema.errors[ 0 ] as unknown as AjvErrorObject;
			return {
				valid: false,
				error: formatValidationError( firstError ),
			};
		}

		const unsupportedFeatures = scanBlueprintForUnsupportedFeatures(
			blueprintJson as BlueprintData
		);
		const warnings = unsupportedFeatures.map( ( feature ) => ( {
			feature: feature.name,
			reason: feature.reason,
		} ) );

		return {
			valid: true,
			warnings,
		};
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : __( 'Invalid Blueprint format' );
		return {
			valid: false,
			error: errorMessage,
		};
	} finally {
		console.warn = originalWarn;
	}
}
