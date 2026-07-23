import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useConnector } from '@/data/core';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { StudioCodePanel } from './studio-code-panel';
import styles from './style.module.css';

function AgenticFeaturesSection() {
	const { data: preferences, isLoading } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	const enabled = preferences?.agenticFeaturesEnabled ?? true;

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ styles.preferenceRow }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Agentic features' ) }</h2>
					<p>
						{ __(
							'Chat with Studio Code to build and edit your sites. Turning it off hides chat and opens sites on their overview instead.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.preferenceControl, styles.toggleControl ) }>
					<FormToggle
						checked={ enabled }
						disabled={ isLoading }
						aria-label={ __( 'Agentic features' ) }
						onChange={ () => savePreferences.mutate( { agenticFeaturesEnabled: ! enabled } ) }
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
			<AgenticFeaturesSection />
			{ connector.capabilities.agentInstructions && <StudioCodePanel /> }
		</div>
	);
}
