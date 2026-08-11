import { FormToggle, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	useAiSettings,
	useSaveAnthropicApiKey,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
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

// Long enough that a typing burst lands as one write, short enough that the
// save still feels immediate when the user pauses.
const KEY_SAVE_DEBOUNCE_MS = 800;

function AnthropicApiKeySection() {
	const { data: settings } = useAiSettings();
	const { mutate: saveKey } = useSaveAnthropicApiKey();
	const { mutate: setProvider, isPending: isSwitching, error: switchError } = useSetAiProvider();
	// `undefined` until the user types: the saved key never reaches the client,
	// so the field shows a truncated preview of it as its placeholder.
	const [ draft, setDraft ] = useState< string | undefined >( undefined );

	const pendingKey = useRef< string | null >( null );
	useEffect( () => {
		if ( draft === undefined ) {
			return;
		}
		const key = draft.trim() === '' ? null : draft.trim();
		pendingKey.current = key;
		const timer = setTimeout( () => {
			pendingKey.current = null;
			saveKey( key );
		}, KEY_SAVE_DEBOUNCE_MS );
		return () => clearTimeout( timer );
	}, [ draft, saveKey ] );

	// Leaving the tab mid-debounce would otherwise drop the last keystrokes.
	useEffect(
		() => () => {
			if ( pendingKey.current !== null ) {
				saveKey( pendingKey.current );
			}
		},
		[ saveKey ]
	);

	if ( ! settings ) {
		return null;
	}

	const usesAnthropic = settings.provider === 'anthropic-api-key';
	const hasKey = draft === undefined ? settings.hasAnthropicApiKey : draft.trim() !== '';

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ clsx( styles.preferenceRow, styles.apiKeyRow ) }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Use your Anthropic API key' ) }</h2>
					<p>
						{ __(
							'Send new conversations directly to Anthropic with your own key, using only Anthropic models. When off, Studio uses the WordPress.com AI service.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.preferenceControl, styles.toggleControl ) }>
					<FormToggle
						checked={ usesAnthropic }
						disabled={ isSwitching || ( ! usesAnthropic && ! hasKey ) }
						aria-label={ __( 'Use your Anthropic API key' ) }
						onChange={ () => setProvider( usesAnthropic ? 'wpcom' : 'anthropic-api-key' ) }
					/>
				</div>
				<div className={ styles.apiKeyControls }>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						type="password"
						label={ __( 'Anthropic API key' ) }
						hideLabelFromVision
						placeholder={ settings.anthropicApiKeyPreview ?? 'sk-ant-…' }
						value={ draft ?? '' }
						onChange={ setDraft }
					/>
				</div>
			</section>
			{ switchError instanceof Error && (
				<p className={ styles.instructionsError }>{ switchError.message }</p>
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
