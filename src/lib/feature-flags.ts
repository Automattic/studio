export interface FeatureFlagDefinition {
	label: string;
	env: string;
	flag: string;
	default: boolean;
}

export interface FeatureFlags {
	selectiveSyncEnabled: boolean;
}

export const FEATURE_FLAGS: Record< keyof FeatureFlags, FeatureFlagDefinition > = {
	selectiveSyncEnabled: {
		label: 'Selective Sync',
		env: 'STUDIO_SELECTIVE_SYNC',
		flag: 'selectiveSyncEnabled',
		default: false,
	},
};

export function getFeatureFlagFromEnv( flag: keyof FeatureFlags ): boolean {
	const envKey = FEATURE_FLAGS[ flag ].env;
	return process.env[ envKey ] === 'true';
}

export function setFeatureFlagInEnv( flag: keyof FeatureFlags, value: boolean ): void {
	const envKey = FEATURE_FLAGS[ flag ].env;
	process.env[ envKey ] = value ? 'true' : 'false';
}
