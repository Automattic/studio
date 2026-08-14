import { FormToggle, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { error as errorIcon } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
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

// Whether `small` can be produced from `big` purely by deleting characters.
function isSubsequenceOf( small: string, big: string ): boolean {
	let matched = 0;
	for ( const char of big ) {
		if ( matched < small.length && char === small[ matched ] ) {
			matched += 1;
		}
	}
	return matched === small.length;
}

function AnthropicApiKeySection() {
	const { data: settings } = useAiSettings();
	const { mutate: saveKey, error } = useSaveAnthropicApiKey();
	// `undefined` until the user types. The saved key never reaches the client:
	// while one exists the field shows its truncated preview as an editable
	// value, so deleting the whole value is how the key gets removed.
	const [ draft, setDraft ] = useState< string | undefined >( undefined );

	const preview = settings?.anthropicApiKeyPreview ?? '';
	// Mid-deletion states of the preview (still a subsequence of it) must not
	// be saved — offline, a truncated fragment would silently replace the real
	// key. Only a fully emptied field (clear → null) or a typed replacement
	// counts.
	const isPreviewRemnant =
		draft !== undefined && draft !== '' && preview !== '' && isSubsequenceOf( draft, preview );
	useDebouncedSave(
		draft === undefined || isPreviewRemnant ? undefined : draft.trim() || null,
		saveKey
	);

	if ( ! settings ) {
		return null;
	}

	const showsPreview = draft === undefined || isPreviewRemnant;

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ clsx( styles.preferenceRow, styles.apiKeyRow ) }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Use your Anthropic API key' ) }</h2>
					<p>
						{ __(
							'Save a key to bill against your Anthropic account. Each conversation then picks its provider from the model menu.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.apiKeyControls, error && styles.apiKeyControlsError ) }>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						type={ showsPreview ? 'text' : 'password' }
						label={ __( 'Anthropic API key' ) }
						hideLabelFromVision
						placeholder={ __( 'Paste your API key: sk-…' ) }
						value={ draft ?? preview }
						onChange={ setDraft }
					/>
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
