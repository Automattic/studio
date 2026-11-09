import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { LearnMoreLink } from '@/features/onboarding';
import { ClaudeIcon } from '@/lib/icons';
import { Button, Input } from '@/lib/ui';
import styles from './style.module.css';
import type { ProviderConnectionProps } from './types';

function AnthropicConnection( {
	Row: SettingsRow,
	connectedBadge,
	connected: hasKey,
	apiKeyPreview,
	error,
	onSelect,
	onSaveKey,
	pending,
	saving,
	formOpen: keyFormOpen,
	onFormOpenChange,
}: ProviderConnectionProps ) {
	const [ key, setKey ] = useState( '' );
	const closeKeyForm = () => {
		setKey( '' );
		onFormOpenChange( false );
	};
	const connectKey = async () => {
		if ( key.trim() ) {
			await onSaveKey( key.trim() );
		}
		await onSelect();
		closeKeyForm();
	};

	return (
		<>
			<SettingsRow
				title={ __( 'Anthropic' ) }
				badge={ hasKey ? connectedBadge : null }
				description={
					<>
						{ __( 'Use Claude with your own API key.' ) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsAnthropicApiKey" />
					</>
				}
			>
				<Button
					variant="outline"
					aria-expanded={ keyFormOpen }
					disabled={ pending }
					onClick={ () => ( keyFormOpen ? closeKeyForm() : onFormOpenChange( true ) ) }
				>
					{ hasKey ? __( 'Manage' ) : __( 'Connect' ) }
				</Button>
			</SettingsRow>
			{ keyFormOpen ? (
				<form
					aria-label={ __( 'Anthropic connection' ) }
					onSubmit={ ( event ) => {
						event.preventDefault();
						if ( ! pending && ( key.trim() || hasKey ) ) {
							void connectKey().catch( () => {} );
						}
					} }
				>
					<SettingsRow
						title={ __( 'Anthropic API key' ) }
						description={ __( 'Usage is billed through your Anthropic account.' ) }
						error={ error }
						stacked
					>
						<div className={ styles.keyForm }>
							<Input
								className={ styles.apiKeyInput }
								type="password"
								autoComplete="off"
								aria-label={ __( 'Anthropic API key' ) }
								placeholder={ apiKeyPreview ?? 'sk-…' }
								value={ key }
								disabled={ pending }
								onChange={ ( event ) => setKey( event.target.value ) }
							/>
							<Button
								variant="accent"
								type="submit"
								disabled={ pending || ( ! key.trim() && ! hasKey ) }
								loading={ saving }
								loadingAnnouncement={ __( 'Saving' ) }
							>
								{ __( 'Save' ) }
							</Button>
							{ hasKey ? (
								<Button
									variant="outline"
									disabled={ pending }
									onClick={ () =>
										void onSaveKey( null ).then( closeKeyForm ).catch( () => {} )
									}
								>
									{ __( 'Remove key' ) }
								</Button>
							) : null }
						</div>
					</SettingsRow>
				</form>
			) : null }
		</>
	);
}

export const anthropicUiProvider = { icon: ClaudeIcon, Connection: AnthropicConnection };
