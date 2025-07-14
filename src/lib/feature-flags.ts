export interface FeatureFlagDefinition {
	label: string;
	env: string;
	flag: string;
	default: boolean;
}

export const FEATURE_FLAGS_DEFINITION = {
	enableBlueprints: {
		label: 'Enable Blueprints',
		env: 'ENABLE_BLUEPRINTS',
		flag: 'enableBlueprints',
		default: false,
	},
} as const;

export const FEATURE_FLAGS: Record< keyof FeatureFlags, FeatureFlagDefinition > =
	FEATURE_FLAGS_DEFINITION;

// Automatically generate the FeatureFlags interface from the FEATURE_FLAGS object
export type FeatureFlags = {
	[ K in keyof typeof FEATURE_FLAGS_DEFINITION ]: boolean;
};

export function getFeatureFlagFromEnv( flag: keyof FeatureFlags ): boolean {
	const flagDefinition = FEATURE_FLAGS[ flag ] as FeatureFlagDefinition | undefined;
	if ( ! flagDefinition ) {
		return false;
	}
	return process.env[ flagDefinition.env ] === 'true';
}

export function setFeatureFlagInEnv( flag: keyof FeatureFlags, value: boolean ): void {
	const flagDefinition = FEATURE_FLAGS[ flag ] as FeatureFlagDefinition | undefined;
	if ( ! flagDefinition ) {
		return;
	}
	process.env[ flagDefinition.env ] = value ? 'true' : 'false';
}

/**
 * Builds a FeatureFlags object with current values from environment variables
 */
export function buildFeatureFlags(): FeatureFlags {
	return Object.fromEntries(
		Object.keys( FEATURE_FLAGS ).map( ( key ) => [
			key,
			getFeatureFlagFromEnv( key as keyof FeatureFlags ),
		] )
	) as FeatureFlags;
}
