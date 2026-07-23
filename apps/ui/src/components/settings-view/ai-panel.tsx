import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { StudioCodePanel } from './studio-code-panel';
import styles from './style.module.css';

function AgenticFeaturesSection() {
	const connector = useConnector();
	const [ disabling, setDisabling ] = useState( false );

	if ( ! connector.capabilities.switchToClassicUi ) {
		return null;
	}

	// Turning agentic features off reloads the window into the classic UI, so
	// there is no enable path here — once disabled, this panel no longer exists.
	const handleDisable = () => {
		setDisabling( true );
		connector.disableAgenticUi().catch( () => setDisabling( false ) );
	};

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ styles.preferenceRow }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Agentic features' ) }</h2>
					<p>
						{ __(
							'Studio Code brings agentic, AI-powered site building to Studio. Turning it off reloads the app into the classic interface.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.preferenceControl, styles.toggleControl ) }>
					<FormToggle
						checked={ ! disabling }
						disabled={ disabling }
						aria-label={ __( 'Agentic features' ) }
						onChange={ handleDisable }
					/>
				</div>
			</section>
		</section>
	);
}

export function AiPanel() {
	const connector = useConnector();
	return (
		<div className={ styles.preferencesPanel }>
			{ connector.capabilities.agentInstructions && <StudioCodePanel /> }
			<AgenticFeaturesSection />
		</div>
	);
}
