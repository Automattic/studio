import { lockAppdata, unlockAppdata, loadUserData, saveUserData } from 'src/storage/user-data';

export interface BetaFeatureDefinition {
	label: string;
	key: string;
	default: boolean;
	description?: string;
}

/**
 * Default values for beta features.
 */
const BETA_FEATURE_DEFAULTS: Record< keyof BetaFeatures, boolean > = {};

/**
 * Returns beta feature definitions with translated labels and descriptions.
 * Must be called at runtime (not at module load) to ensure translations are loaded.
 */
export function getBetaFeaturesDefinition(): Record< keyof BetaFeatures, BetaFeatureDefinition > {
	return {};
}

function buildBetaFeatures( userData: BetaFeatures | undefined ): BetaFeatures {
	const features: Partial< BetaFeatures > = {};
	const keys = Object.keys( BETA_FEATURE_DEFAULTS ) as ( keyof BetaFeatures )[];
	keys.forEach( ( key ) => {
		features[ key ] = userData?.[ key ] ?? BETA_FEATURE_DEFAULTS[ key ];
	} );
	return features as BetaFeatures;
}

export async function getBetaFeatures(): Promise< BetaFeatures > {
	const userData = await loadUserData();
	return buildBetaFeatures( userData.betaFeatures );
}

export async function updateBetaFeature(
	key: keyof BetaFeatures,
	value: boolean
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const betaFeatures: BetaFeatures = userData.betaFeatures || ( {} as BetaFeatures );
		betaFeatures[ key ] = value;
		userData.betaFeatures = betaFeatures;
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}
