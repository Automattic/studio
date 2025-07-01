export interface FeatureFlagDefinition {
	label: string;
	env: string;
	flag: string;
	default: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FeatureFlags {}

export const FEATURE_FLAGS: Record< keyof FeatureFlags, FeatureFlagDefinition > = {};

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
