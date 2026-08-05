import { __ } from '@wordpress/i18n';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
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
	enableAgenticUi: false,
	reprintPull: false,
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
		enableAgenticUi: {
			label: __( 'New Studio experience' ),
			key: 'enableAgenticUi',
			default: BETA_FEATURE_DEFAULTS.enableAgenticUi,
			description: __( 'A redesigned interface with AI-powered site building.' ),
		},
		reprintPull: {
			label: __( 'Reprint pull engine' ),
			key: 'reprintPull',
			default: BETA_FEATURE_DEFAULTS.reprintPull,
			description: __( 'Pull live sites with the Reprint engine instead of Jetpack backups.' ),
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

// Where a UI-mode switch was triggered from. Passed through to the Tracks event so we can tell the
// Settings toggle from the "Try it" banner and the app menu. Omitted for non-user writes (e.g. the
// boot-time migration), which must not emit an event.
export type AgenticUiSurface = 'settings' | 'banner' | 'menu';

export async function updateBetaFeature(
	key: keyof BetaFeatures,
	value: boolean,
	surface?: AgenticUiSurface
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

	if ( key === 'enableAgenticUi' && surface ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_UI_CHANGE, {
			type: value ? 'agentic' : 'classic',
			surface,
		} );
	}
}
