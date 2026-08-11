import { FormToggle, TextControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useAiSettings, useSaveAnthropicApiKey } from '@/data/queries/use-ai-settings';
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
							'Chat with an agent that builds and edits your sites. Turning this off hides chat — your existing conversations are kept.'
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

function AnthropicApiKeySection() {
	const { data: settings } = useAiSettings();
	const { mutate: saveKey, isPending, isError, error } = useSaveAnthropicApiKey();
	const [ draft, setDraft ] = useState( '' );

	if ( ! settings ) {
		return null;
	}

	const description = settings.hasAnthropicApiKey
		? sprintf(
				// translators: %s is the last characters of the saved API key, e.g. "a1b2".
				__(
					'New conversations go directly to Anthropic with your key (ending in %s) and only offer Anthropic models.'
				),
				settings.anthropicApiKeySuffix ?? ''
		  )
		: __(
				'Add your own Anthropic API key to send new conversations directly to Anthropic. Without a key, Studio uses the WordPress.com AI service.'
		  );

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ clsx( styles.preferenceRow, styles.apiKeyRow ) }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Anthropic API key' ) }</h2>
					<p>{ description }</p>
				</div>
				<div className={ styles.apiKeyControls }>
					{ settings.hasAnthropicApiKey ? (
						<Button variant="outline" disabled={ isPending } onClick={ () => saveKey( null ) }>
							{ __( 'Remove key' ) }
						</Button>
					) : (
						<>
							<TextControl
								__nextHasNoMarginBottom
								__next40pxDefaultSize
								type="password"
								label={ __( 'Anthropic API key' ) }
								hideLabelFromVision
								placeholder="sk-ant-…"
								value={ draft }
								onChange={ setDraft }
								disabled={ isPending }
							/>
							<Button
								variant="outline"
								disabled={ isPending || draft.trim() === '' }
								onClick={ () => saveKey( draft.trim(), { onSuccess: () => setDraft( '' ) } ) }
							>
								{ __( 'Save' ) }
							</Button>
						</>
					) }
				</div>
			</section>
			{ isError && (
				<p className={ styles.instructionsError }>
					{ error instanceof Error && error.message
						? error.message
						: __( 'Saving the API key failed. Please try again.' ) }
				</p>
			) }
		</section>
	);
}

export function AiPanel() {
	const connector = useConnector();
	return (
		<div className={ styles.preferencesPanel }>
			<AgenticFeaturesSection />
			{ connector.capabilities.aiSettings && <AnthropicApiKeySection /> }
			{ connector.capabilities.agentInstructions && <StudioCodePanel /> }
		</div>
	);
}
