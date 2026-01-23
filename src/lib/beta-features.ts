import { __ } from '@wordpress/i18n';
import { lockAppdata, unlockAppdata, loadUserData, saveUserData } from 'src/storage/user-data';

export interface BetaFeatureDefinition {
	label: string;
	key: string;
	default: boolean;
	description?: string;
}

/**
 * Static configuration for beta features (keys and defaults only).
 * Used internally for feature state management.
 */
const BETA_FEATURES_CONFIG: Record< keyof BetaFeatures, { key: string; default: boolean } > = {
	multiWorkerSupport: {
		key: 'multiWorkerSupport',
		default: false,
	},
	xdebugSupport: {
		key: 'xdebugSupport',
		default: false,
	},
};

/**
 * Returns beta feature definitions with translated labels and descriptions.
 * Must be called at runtime (not at module load) to ensure translations are loaded.
 */
export function getBetaFeaturesDefinition(): Record< keyof BetaFeatures, BetaFeatureDefinition > {
	return {
		multiWorkerSupport: {
			label: __( 'Multi-Worker Support' ),
			key: 'multiWorkerSupport',
			default: false,
			description: __( 'Enable multi-worker PHP processing for faster performance' ),
		},
		xdebugSupport: {
			label: __( 'Xdebug Support' ),
			key: 'xdebugSupport',
			default: false,
			description: __( 'Enable PHP debugging with Xdebug (one site at a time)' ),
		},
	};
}

function buildBetaFeatures( userData: BetaFeatures | undefined ): BetaFeatures {
	const features: Partial< BetaFeatures > = {};
	const keys = Object.keys( BETA_FEATURES_CONFIG );
	keys.forEach( ( key ) => {
		const featureKey = key as keyof BetaFeatures;
		const config = BETA_FEATURES_CONFIG[ featureKey ];
		( features as Record< string, boolean > )[ key ] = userData?.[ featureKey ] ?? config.default;
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
