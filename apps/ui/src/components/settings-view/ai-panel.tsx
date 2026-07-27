import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { OfflineNotice } from '@/components/offline-banner';
import { useConnector } from '@/data/core';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AccountSection } from './account-section';
import { usePreviewAgenticFeatures } from './settings-preview';
import { SkillsPanel } from './skills-panel';
import { StudioCodePanel } from './studio-code-panel';
import styles from './style.module.css';

// Toggles whether chat is on offer. It's a stored preference, not a UI switch —
// turning it off keeps you in the agentic UI and preserves existing
// conversations. Switching all the way back to the classic UI lives in Settings.
// Agentic features need a WordPress.com account, so the toggle is locked (and
// reads off) until the user signs in.
function AgenticFeaturesSection() {
	const { reason } = usePreviewAgenticFeatures();
	const { data: preferences, isLoading } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	const enabled = preferences?.agenticFeaturesEnabled ?? true;
	const signedOut = reason === 'signed-out';

	return (
		<section className={ clsx( styles.card, signedOut && styles.cardDisabled ) }>
			<div className={ styles.cardHeader }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ __( 'Agentic features' ) }</h2>
					<p className={ styles.cardDescription }>
						{ __(
							'Chat with an agent that builds and edits your sites. Turning this off hides chat — your existing conversations are kept.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.cardHeaderActions, styles.toggleControl ) }>
					<FormToggle
						checked={ enabled && ! signedOut }
						disabled={ isLoading || signedOut }
						aria-label={ __( 'Agentic features' ) }
						onChange={ () => savePreferences.mutate( { agenticFeaturesEnabled: ! enabled } ) }
					/>
				</div>
			</div>
			{ signedOut ? (
				<p className={ styles.signInNotice }>{ __( 'You must log in for agentic features.' ) }</p>
			) : null }
		</section>
	);
}

export function AiPanel() {
	const connector = useConnector();
	// Offline is the one whole-tab state worth a banner here; the signed-out
	// sign-in pitch and the usage meters (AI credits, preview sites) live in the
	// account sidebar.
	const { reason } = usePreviewAgenticFeatures();

	return (
		<div className={ styles.settingsLayout }>
			<AccountSection />
			<div className={ styles.settingsMain }>
				{ reason === 'offline' ? <OfflineNotice /> : null }
				<AgenticFeaturesSection />
				{ connector.capabilities.agentInstructions && <StudioCodePanel /> }
				<SkillsPanel />
			</div>
		</div>
	);
}
