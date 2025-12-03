export interface FeatureFlagDefinition {
	label: string;
	env: string;
	flag: string;
	default: boolean;
}

export const FEATURE_FLAGS_DEFINITION: Record< keyof FeatureFlags, FeatureFlagDefinition > = {
	enableBlueprints: {
		label: 'Enable Blueprints',
		env: 'ENABLE_BLUEPRINTS',
		flag: 'enableBlueprints',
		default: true,
	},
} as const;

export const FEATURE_FLAGS: Record< keyof FeatureFlags, FeatureFlagDefinition > =
	FEATURE_FLAGS_DEFINITION;

export function getFeatureFlagFromEnv( flag: keyof FeatureFlags ): boolean {
	const flagDefinition = FEATURE_FLAGS[ flag ] as FeatureFlagDefinition | undefined;
	if ( ! flagDefinition ) {
		return false;
	}
	const envValue = process.env[ flagDefinition.env ];
	if ( envValue === undefined ) {
		return flagDefinition.default;
	}
	return envValue === 'true';
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
	const flags: Partial< FeatureFlags > = {};
	const keys = Object.keys( FEATURE_FLAGS );
	keys.forEach( ( key ) => {
		( flags as Record< string, boolean > )[ key ] = getFeatureFlagFromEnv(
			key as keyof FeatureFlags
		);
	} );
	return flags as FeatureFlags;
}
