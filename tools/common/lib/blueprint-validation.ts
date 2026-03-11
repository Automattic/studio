import { __, sprintf } from '@wordpress/i18n';
import validateBlueprintSchema from '@wp-playground/blueprints/blueprint-schema-validator';
import { __isStepDefinition } from './blueprint-settings';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

interface UnsupportedFeature {
	type: 'step' | 'property';
	name: string;
	reason: string;
}

/**
 * List of blueprint features that are not supported in Studio
 */
const UNSUPPORTED_BLUEPRINT_FEATURES: UnsupportedFeature[] = [];

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

export type BlueprintPreferredVersions = {
	php?: string;
	wp?: string;
};

export function scanBlueprintForUnsupportedFeatures(
	blueprint: BlueprintV1Declaration
): UnsupportedFeature[] {
	const foundUnsupported: UnsupportedFeature[] = [];
	const steps = Array.isArray( blueprint.steps )
		? blueprint.steps.filter( __isStepDefinition )
		: [];

	for ( const step of steps ) {
		if ( step.step && ! isStepSupported( step.step ) ) {
			const featureInfo = getUnsupportedFeatureInfo( step.step );
			if ( featureInfo ) {
				foundUnsupported.push( featureInfo );
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
	blueprint: BlueprintV1Declaration | undefined
): BlueprintV1Declaration | undefined {
	if ( ! blueprint ) {
		return undefined;
	}
	const filtered = { ...blueprint };
	const steps = Array.isArray( filtered.steps ) ? filtered.steps.filter( __isStepDefinition ) : [];
	filtered.steps = steps.filter( ( step ) => step && step.step && isStepSupported( step.step ) );

	for ( const [ key ] of Object.entries( filtered ) ) {
		if ( ! isPropertySupported( key ) ) {
			// @ts-expect-error We're not truly deleting unknown keys from `filtered` here, and even if we
			// were, this would still be a safe operation.
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
 * Validates a blueprint using the official schema and scans for unsupported features.
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

	const unsupportedFeatures = scanBlueprintForUnsupportedFeatures(
		// `validateBlueprintSchema()` doesn't give us a proper type guard, but in reality, it ensures `blueprintJson` has the correct type
		blueprintJson as BlueprintV1Declaration
	);
	const warnings = unsupportedFeatures.map( ( feature ) => ( {
		feature: feature.name,
		reason: feature.reason,
	} ) );

	return {
		valid: true,
		warnings,
	};
}
