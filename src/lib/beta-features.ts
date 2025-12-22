import { lockAppdata, unlockAppdata, loadUserData, saveUserData } from 'src/storage/user-data';

export interface BetaFeatureDefinition {
	label: string;
	key: string;
	default: boolean;
	description?: string;
}

const BETA_FEATURES_DEFINITION: Record< keyof BetaFeatures, BetaFeatureDefinition > = {
	studioSitesCli: {
		label: 'Studio Sites CLI',
		key: 'studioSitesCli',
		default: false,
		description: '"studio site" command to manage local sites from terminal',
	},
	multiWorkerSupport: {
		label: 'Multi-Worker Support',
		key: 'multiWorkerSupport',
		default: false,
		description: 'Enable multi-worker PHP processing for faster performance',
	},
	xdebugSupport: {
		label: 'Xdebug Support',
		key: 'xdebugSupport',
		default: false,
		description: 'Enable PHP debugging with Xdebug (one site at a time)',
	},
} as const;

export const BETA_FEATURES: Record< keyof BetaFeatures, BetaFeatureDefinition > =
	BETA_FEATURES_DEFINITION;

function buildBetaFeatures( userData: BetaFeatures | undefined ): BetaFeatures {
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
