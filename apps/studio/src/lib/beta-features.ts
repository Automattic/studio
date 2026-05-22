import { SITE_RUNTIME_NATIVE_PHP, SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
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
	enableDesksUiSwitch: false,
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
			description: __( 'Run Studio sites with native PHP instead of Playground.' ),
		},
		enableDesksUiSwitch: {
			label: __( 'Enable Studio UI Switcher' ),
			key: 'enableDesksUiSwitch',
			default: BETA_FEATURE_DEFAULTS.enableDesksUiSwitch,
			description: __( 'Show the option to switch Studio UI modes.' ),
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

function applyBetaFeaturesToEnvironment( features: BetaFeatures ): void {
	process.env.STUDIO_RUNTIME = features.nativePhpRuntime
		? SITE_RUNTIME_NATIVE_PHP
		: SITE_RUNTIME_PLAYGROUND;
}

export async function getBetaFeatures(): Promise< BetaFeatures > {
	const userData = await loadUserData();
	const betaFeatures = buildBetaFeatures( userData.betaFeatures );
	applyBetaFeaturesToEnvironment( betaFeatures );
	return betaFeatures;
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
		applyBetaFeaturesToEnvironment( betaFeatures );
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}
