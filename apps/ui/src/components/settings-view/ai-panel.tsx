import { API_KEY_PREVIEW_MARKER } from '@studio/common/ai/providers';
import { FormToggle, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { error as errorIcon } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useAiSettings, useSaveAnthropicApiKey } from '@/data/queries/use-ai-settings';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { StudioCodePanel } from './studio-code-panel';
import styles from './style.module.css';
import { useDebouncedSave } from './use-debounced-save';

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
	const { mutate: saveKey, error } = useSaveAnthropicApiKey();
	// `undefined` until the user types. The saved key never reaches the client:
	// the field shows its obfuscated preview (`sk-…***1234`) read-only, and the
	// Remove button is how the key gets deleted — an editable preview would let
	// a stray edit save a truncated fragment as the key.
	const [ draft, setDraft ] = useState< string | undefined >( undefined );

	const showsPreview = draft === undefined && Boolean( settings?.anthropicApiKeyPreview );
	// An emptied field saves `null`; the marker check is a belt-and-braces
	// guard so preview text can never be stored as a key.
	const pendingSave =
		draft === undefined || draft.includes( API_KEY_PREVIEW_MARKER )
			? undefined
			: draft.trim() || null;
	useDebouncedSave( pendingSave, saveKey );

	if ( ! settings ) {
		return null;
	}

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ clsx( styles.preferenceRow, styles.apiKeyRow ) }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Anthropic API key' ) }</h2>
					<p>
						{ __(
							'Add your own API key to pick Anthropic as the provider in a conversation. It bills against your Anthropic account; without it Studio uses your WordPress.com AI credits.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.apiKeyControls, error && styles.apiKeyControlsError ) }>
					<div className={ styles.apiKeyFieldRow }>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							type={ showsPreview ? 'text' : 'password' }
							label={ __( 'Anthropic API key' ) }
							hideLabelFromVision
							placeholder={ __( 'Paste your API key: sk-…' ) }
							value={ showsPreview ? settings.anthropicApiKeyPreview ?? '' : draft ?? '' }
							readOnly={ showsPreview }
							onChange={ setDraft }
						/>
						{ showsPreview && (
							<Button variant="outline" onClick={ () => saveKey( null ) }>
								{ __( 'Remove' ) }
							</Button>
						) }
					</div>
				</div>
			</section>
			{ error && (
				<p role="alert" className="components-validated-control__indicator is-invalid">
					<Icon
						className="components-validated-control__indicator-icon"
						icon={ errorIcon }
						size={ 16 }
						fill="currentColor"
					/>
					{ error.message }
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
