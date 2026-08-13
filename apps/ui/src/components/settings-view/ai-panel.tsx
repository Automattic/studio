import { FormToggle, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { error as errorIcon } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	useAiSettings,
	useSaveAnthropicApiKey,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SkillsCard } from './skills-panel';
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
	const { mutate: saveKey, isPending: isSaving, error: saveError } = useSaveAnthropicApiKey();
	const { mutate: setProvider, isPending: isSwitching, error: switchError } = useSetAiProvider();
	// `undefined` until the user types: the saved key never reaches the client,
	// so the field shows a truncated preview of it as its placeholder.
	const [ draft, setDraft ] = useState< string | undefined >( undefined );
	const [ isConfiguring, setIsConfiguring ] = useState( false );
	const usesAnthropic = settings?.provider === 'anthropic-api-key';
	const enabled = usesAnthropic || isConfiguring;
	const saveDraft = useCallback(
		( key: string | null ) => {
			saveKey( key, {
				onSuccess: () => {
					if ( key ) {
						setProvider( 'anthropic-api-key', {
							onSuccess: () => setIsConfiguring( false ),
						} );
					} else {
						setIsConfiguring( false );
					}
				},
			} );
		},
		[ saveKey, setProvider ]
	);

	// An emptied field saves `null`, clearing the stored key.
	useDebouncedSave( enabled && draft !== undefined ? draft.trim() || null : undefined, saveDraft );

	if ( ! settings ) {
		return null;
	}

	const error = saveError ?? switchError;
	const handleToggle = () => {
		if ( usesAnthropic ) {
			setProvider( 'wpcom' );
			return;
		}
		if ( isConfiguring ) {
			setDraft( undefined );
			setIsConfiguring( false );
			return;
		}
		if ( settings.hasAnthropicApiKey ) {
			setProvider( 'anthropic-api-key' );
			return;
		}
		setIsConfiguring( true );
	};

	return (
		<section className={ styles.preferenceSectionGroup }>
			<section className={ clsx( styles.preferenceRow, styles.apiKeyRow ) }>
				<div className={ styles.preferenceText }>
					<h2>{ __( 'Use your Anthropic API key' ) }</h2>
					<p>
						{ __(
							'Use your own API key, which bills against your Anthropic account. When off, Studio uses your WordPress.com AI credits.'
						) }
					</p>
				</div>
				<div className={ clsx( styles.preferenceControl, styles.toggleControl ) }>
					<FormToggle
						checked={ enabled }
						disabled={ isSaving || isSwitching }
						aria-label={ __( 'Use your Anthropic API key' ) }
						onChange={ handleToggle }
					/>
				</div>
				{ enabled ? (
					<div className={ clsx( styles.apiKeyControls, error && styles.apiKeyControlsError ) }>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							type="password"
							label={ __( 'Anthropic API key' ) }
							hideLabelFromVision
							placeholder={ settings.anthropicApiKeyPreview ?? __( 'Paste your API key: sk-…' ) }
							value={ draft ?? '' }
							onChange={ setDraft }
						/>
					</div>
				) : null }
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
			<SkillsCard />
		</div>
	);
}
