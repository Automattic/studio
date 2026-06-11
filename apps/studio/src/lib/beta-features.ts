import {
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { __ } from '@wordpress/i18n';
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
const BETA_FEATURE_DEFAULTS: Record< keyof BetaFeatures, boolean > = {
	remoteSession: false,
	nativePhpRuntime: false,
};

/**
 * Returns beta feature definitions with translated labels and descriptions.
 * Must be called at runtime (not at module load) to ensure translations are loaded.
 */
export function getBetaFeaturesDefinition(): Record< keyof BetaFeatures, BetaFeatureDefinition > {
	return {
		remoteSession: {
			label: __( 'Remote Session' ),
			key: 'remoteSession',
			default: BETA_FEATURE_DEFAULTS.remoteSession,
			description: __( 'Control Studio from Telegram via the remote-session daemon.' ),
		},
		nativePhpRuntime: {
			key: 'nativePhpRuntime',
			label: __( 'Native PHP runtime' ),
			default: BETA_FEATURE_DEFAULTS.nativePhpRuntime,
			description: __( 'Use native PHP instead of the Playground sandbox for new sites.' ),
		},
	};
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

// The runtime is a per-site setting; the beta feature only selects the
// default for newly created sites.
export async function getDefaultSiteRuntime(): Promise< SiteRuntime > {
	const betaFeatures = await getBetaFeatures();
	return betaFeatures.nativePhpRuntime ? SITE_RUNTIME_NATIVE_PHP : SITE_RUNTIME_PLAYGROUND;
}

export async function updateBetaFeature(
	key: keyof BetaFeatures,
	value: boolean
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const betaFeatures = await getBetaFeatures();
		// If `BetaFeatures` is ever empty again, `key` resolves to `never` and this
		// line stops type-checking. That's fine — rely on type checking at the call site.
		betaFeatures[ key ] = value;
		userData.betaFeatures = betaFeatures;
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}
