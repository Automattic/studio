import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { LearnMoreLink } from '@/features/onboarding';
import { Button, Input } from '@/lib/ui';
import styles from './style.module.css';
import type { ProviderConnectionProps } from './types';
import type { DocsLinkKey } from '@studio/common/lib/docs-links';
import type { ComponentProps, ComponentType } from 'react';

export interface ApiKeyUiProviderConfig {
	icon: ComponentType< ComponentProps< 'svg' > >;
	getTitle: () => string;
	getDescription: () => string;
	docsLinksKey: DocsLinkKey;
	getFormLabel: () => string;
	getFieldTitle: () => string;
	getBillingNote: () => string;
	keyPlaceholder: string;
}

export function createApiKeyUiProvider( config: ApiKeyUiProviderConfig ) {
	function ApiKeyProviderConnection( {
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
		const fieldTitle = config.getFieldTitle();

		return (
			<>
				<SettingsRow
					title={ config.getTitle() }
					badge={ hasKey ? connectedBadge : null }
					description={
						<>
							{ config.getDescription() } <LearnMoreLink docsLinksKey={ config.docsLinksKey } />
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
						aria-label={ config.getFormLabel() }
						onSubmit={ ( event ) => {
							event.preventDefault();
							if ( ! pending && ( key.trim() || hasKey ) ) {
								void connectKey().catch( () => {} );
							}
						} }
					>
						<SettingsRow
							title={ fieldTitle }
							description={ config.getBillingNote() }
							error={ error }
							stacked
						>
							<div className={ styles.keyForm }>
								<Input
									className={ styles.apiKeyInput }
									type="password"
									autoComplete="off"
									aria-label={ fieldTitle }
									placeholder={ apiKeyPreview ?? config.keyPlaceholder }
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
											void onSaveKey( null )
												.then( closeKeyForm )
												.catch( () => {} )
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

	return {
		icon: config.icon,
		Connection: ApiKeyProviderConnection,
	};
}
