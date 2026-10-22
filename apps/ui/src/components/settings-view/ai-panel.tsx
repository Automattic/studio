import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useAiSettings, useSaveAnthropicApiKey } from '@/data/queries/use-ai-settings';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SettingsGroup, SettingsRow, SettingsToggle } from './rows';
import styles from './style.module.css';
import { useDebouncedSave } from './use-debounced-save';

function AgenticFeaturesSection() {
	const { data: preferences, isLoading } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();

	return (
		<SettingsGroup>
			<SettingsRow
				title={ __( 'Studio Code' ) }
				description={ __(
					'Chat with an agent that builds and edits your sites. Turning this off hides chat — your existing conversations are kept.'
				) }
			>
				<SettingsToggle
					label={ __( 'Studio Code' ) }
					checked={ preferences?.agenticFeaturesEnabled ?? true }
					disabled={ isLoading }
					onChange={ ( agenticFeaturesEnabled ) =>
						savePreferences.mutate( { agenticFeaturesEnabled } )
					}
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}

function AnthropicApiKeySection() {
	const { data: settings } = useAiSettings();
	const { mutate: saveKey, error } = useSaveAnthropicApiKey();
	// `undefined` until the user types: the saved key never reaches the client,
	// so the field shows a truncated preview of it as its placeholder.
	const [ draft, setDraft ] = useState< string | undefined >( undefined );

	// An emptied field saves `null`, clearing the stored key.
	useDebouncedSave( draft === undefined ? undefined : draft.trim() || null, saveKey );

	if ( ! settings ) {
		return null;
	}

	return (
		<SettingsGroup>
			<SettingsRow
				title={ __( 'Use your Anthropic API key' ) }
				description={ __(
					'Use your own API key, which bills against your Anthropic account, then select your preferred provider for each conversation from the models menu.'
				) }
				error={ error?.message }
				stacked
			>
				<Input
					className={ styles.apiKeyInput }
					type="password"
					autoComplete="off"
					aria-label={ __( 'Anthropic API key' ) }
					aria-invalid={ error ? true : undefined }
					placeholder={ settings.anthropicApiKeyPreview ?? __( 'Paste your API key: sk-…' ) }
					value={ draft ?? '' }
					onChange={ ( event ) => setDraft( event.target.value ) }
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}

export function AiPanel() {
	return (
		<div className={ styles.preferencesPanel }>
			<AgenticFeaturesSection />
			<AnthropicApiKeySection />
		</div>
	);
}
