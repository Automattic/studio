export interface FeatureFlagDefinition {
	label: string;
	env: string;
	flag: string;
	default: boolean;
}

export interface FeatureFlags {
	placeholder: boolean; // placeholder to avoid type errors
}

export const FEATURE_FLAGS: Record< keyof FeatureFlags, FeatureFlagDefinition > = {
	// No feature flags currently defined
	// Add new feature flags here as needed
} as Record< keyof FeatureFlags, FeatureFlagDefinition >;

export function getFeatureFlagFromEnv( flag: keyof FeatureFlags ): boolean {
	const envKey = FEATURE_FLAGS[ flag ].env;
	return process.env[ envKey ] === 'true';
}

export function setFeatureFlagInEnv( flag: keyof FeatureFlags, value: boolean ): void {
	const envKey = FEATURE_FLAGS[ flag ].env;
	process.env[ envKey ] = value ? 'true' : 'false';
}
