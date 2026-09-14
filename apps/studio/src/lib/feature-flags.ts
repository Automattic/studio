export interface FeatureFlagDefinition {
	label: string;
	env: string;
	flag: string;
	default: boolean;
}

// No flags are in flight right now. Add entries here (and to the `FeatureFlags` interface in
// `ipc-types.d.ts`) to expose one via `ENABLE_*` env vars, the dev Feature Flags menu, and the
// wpcom `/studio-app/feature-flags` override.
export const FEATURE_FLAGS: Record< keyof FeatureFlags, FeatureFlagDefinition > = {} as const;

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
