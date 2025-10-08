export interface BetaFeatureDefinition {
	label: string;
	key: string;
	default: boolean;
}

export const BETA_FEATURES_DEFINITION: Record< keyof BetaFeatures, BetaFeatureDefinition > = {
	studioSitesCli: {
		label: 'Studio Sites CLI',
		key: 'studioSitesCli',
		default: false,
	},
} as const;

export const BETA_FEATURES: Record< keyof BetaFeatures, BetaFeatureDefinition > =
	BETA_FEATURES_DEFINITION;

export function buildBetaFeatures( userData: BetaFeatures | undefined ): BetaFeatures {
	const features: Partial< BetaFeatures > = {};
	const keys = Object.keys( BETA_FEATURES );
	keys.forEach( ( key ) => {
		const featureKey = key as keyof BetaFeatures;
		const definition = BETA_FEATURES[ featureKey ];
		( features as Record< string, boolean > )[ key ] =
			userData?.[ featureKey ] ?? definition.default;
	} );
	return features as BetaFeatures;
}
