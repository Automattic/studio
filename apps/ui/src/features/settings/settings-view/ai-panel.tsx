import { AI_PROVIDER_IDS, getAiProvider } from '@studio/agent/protocol/providers';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import {
	useAiSettings,
	useSaveAiProviderApiKey,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
import { getAiProviderUi } from '@/features/ai-providers';
import { LearnMoreLink } from '@/features/onboarding';
import { Button } from '@/lib/ui';
import { connectedBadge, SettingsGroup, SettingsRow, SettingsSelect } from './rows';
import styles from './style.module.css';
import type { AiProviderId } from '@studio/agent/protocol/providers';

function ProvidersSection( { onManageCredits }: { onManageCredits: () => void } ) {
	const settings = useAiSettings();
	const setProvider = useSetAiProvider();
	const saveKey = useSaveAiProviderApiKey();
	const [ openForm, setOpenForm ] = useState< AiProviderId | null >( null );
	const pending = settings.isLoading || saveKey.isPending || setProvider.isPending;
	const hasOptionalConnection = AI_PROVIDER_IDS.some(
		( id ) =>
			getAiProvider( id ).connection.type === 'api-key' &&
			settings.data?.connections[ id ].connected
	);

	return (
		<SettingsGroup title={ __( 'Providers' ) }>
			{ settings.isError ? (
				<SettingsRow title={ __( "Couldn't load providers." ) }>
					<Button variant="outline" onClick={ () => void settings.refetch() }>
						{ __( 'Retry' ) }
					</Button>
				</SettingsRow>
			) : null }
			{ AI_PROVIDER_IDS.map( ( id ) => {
				const { Connection } = getAiProviderUi( id );
				return (
					<Connection
						key={ id }
						Row={ SettingsRow }
						connectedBadge={ connectedBadge() }
						connected={ !! settings.data?.connections[ id ].connected }
						apiKeyPreview={ settings.data?.connections[ id ].apiKeyPreview }
						error={ ( saveKey.error ?? setProvider.error )?.message }
						onSelect={ async () => {
							await setProvider.mutateAsync( id );
						} }
						onSaveKey={ async ( key ) => {
							await saveKey.mutateAsync( { provider: id, key } );
						} }
						pending={ pending }
						saving={ saveKey.isPending || setProvider.isPending }
						formOpen={ openForm === id }
						onFormOpenChange={ ( open ) => setOpenForm( open ? id : null ) }
						onManageCredits={ onManageCredits }
					/>
				);
			} ) }
			{ hasOptionalConnection && settings.data ? (
				<SettingsRow
					title={ __( 'Default provider' ) }
					description={ __( 'The provider new chats use.' ) }
					error={ openForm ? undefined : setProvider.error?.message }
				>
					<SettingsSelect< AiProviderId >
						label={ __( 'Default provider' ) }
						value={ settings.data.provider }
						disabled={ pending }
						options={ AI_PROVIDER_IDS.map( ( id ) => ( {
							value: id,
							label: getAiProvider( id ).label,
						} ) ) }
						onChange={ ( provider ) => setProvider.mutate( provider ) }
					/>
				</SettingsRow>
			) : null }
		</SettingsGroup>
	);
}

export function AiPanel( { onManageCredits }: { onManageCredits: () => void } ) {
	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup>
				<SettingsRow
					title={ __( 'Providers' ) }
					description={
						<>
							{ __(
								'Providers give WordPress Studio access to the models that understand your requests and make changes to your sites. Connect one to build pages, write content, and customize themes and plugins through chat.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsStudioCode" />
						</>
					}
				/>
			</SettingsGroup>
			<ProvidersSection onManageCredits={ onManageCredits } />
		</div>
	);
}
