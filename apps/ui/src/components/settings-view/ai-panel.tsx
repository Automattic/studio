import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useState } from 'react';
import { OfflineNotice } from '@/components/offline-banner';
import { useConnector } from '@/data/core';
import { AccountSection } from './account-section';
import { usePreviewAgenticFeatures } from './settings-preview';
import { SkillsPanel } from './skills-panel';
import { StudioCodePanel } from './studio-code-panel';
import styles from './style.module.css';

function AgenticFeaturesSection() {
	const connector = useConnector();
	const { reason } = usePreviewAgenticFeatures();
	const [ disabling, setDisabling ] = useState( false );
	const canSwitchToClassic = connector.capabilities.switchToClassicUi;
	// Agentic features need a WordPress.com account, so they read as off and
	// locked until the user signs in.
	const signedOut = reason === 'signed-out';

	// Turning agentic features off reloads the window into the classic UI, so
	// there is no enable path — the toggle only ever goes one way. Hosts that
	// can't switch (e.g. the hosted browser) still get the card, just without
	// the toggle.
	const handleDisable = () => {
		setDisabling( true );
		connector.disableAgenticUi().catch( () => setDisabling( false ) );
	};

	return (
		<section className={ clsx( styles.card, signedOut && styles.cardDisabled ) }>
			<div className={ styles.cardHeader }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ __( 'Agentic features' ) }</h2>
					<p className={ styles.cardDescription }>
						{ canSwitchToClassic && ! signedOut
							? __(
									'Studio Code brings agentic, AI-powered site building to Studio. Turning it off reloads the app into the classic interface.'
							  )
							: __( 'Studio Code brings agentic, AI-powered site building to Studio.' ) }
					</p>
				</div>
				{ canSwitchToClassic ? (
					<div className={ clsx( styles.cardHeaderActions, styles.toggleControl ) }>
						<FormToggle
							checked={ ! disabling && ! signedOut }
							disabled={ disabling || signedOut }
							aria-label={ __( 'Agentic features' ) }
							onChange={ handleDisable }
						/>
					</div>
				) : null }
			</div>
		</section>
	);
}

export function AiPanel() {
	const connector = useConnector();
	// Offline is the one whole-tab state worth a banner here; the signed-out
	// sign-in pitch and the usage meters (AI credits, preview sites) now live in
	// the account sidebar.
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
