import {
	getConnectFields,
	getProviderDescriptor,
	PROVIDER_IDS,
	type ProviderId,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { getProviderIntent } from '@/data/account-analytics';
import { useConnector } from '@/data/core';
import {
	useAiSettings,
	useConnectProvider,
	useDisconnectProvider,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { LearnMoreLink } from '@/features/onboarding';
import { useOffline } from '@/lib/hooks';
import { Button, Input } from '@/lib/ui';
import { connectedBadge, SettingsGroup, SettingsRow, SettingsSelect } from './rows';
import styles from './style.module.css';

// A provider that connects with a form: the form comes from its descriptor.
function ProviderFormRow( { provider }: { provider: ProviderId } ) {
	const settings = useAiSettings();
	const connect = useConnectProvider( provider );
	const disconnect = useDisconnectProvider( provider );
	const setProvider = useSetAiProvider();
	const descriptor = getProviderDescriptor( provider );
	const fields = getConnectFields( provider );
	const account = settings.data?.accounts[ provider ];
	const [ formOpen, setFormOpen ] = useState( false );
	const [ values, setValues ] = useState< Record< string, string > >( {} );
	const pending =
		settings.isLoading || connect.isPending || disconnect.isPending || setProvider.isPending;
	const filled = fields.every( ( field ) => values[ field.name ]?.trim() );

	const closeForm = () => {
		setValues( {} );
		setFormOpen( false );
	};
	// Saving the values the account already has just selects the provider.
	const save = async () => {
		if ( filled ) {
			await connect.mutateAsync( values );
		}
		await setProvider.mutateAsync( provider );
		closeForm();
	};

	return (
		<>
			<SettingsRow
				title={ descriptor.label }
				settingId={ `${ provider }-provider` }
				badge={ account?.connected ? connectedBadge() : null }
				description={
					<>
						{ descriptor.description?.() }{ ' ' }
						{ descriptor.learnMoreUrl ? <LearnMoreLink url={ descriptor.learnMoreUrl } /> : null }
					</>
				}
			>
				<Button
					variant="outline"
					aria-expanded={ formOpen }
					disabled={ pending }
					onClick={ () => ( formOpen ? closeForm() : setFormOpen( true ) ) }
				>
					{ account?.connected ? __( 'Manage' ) : __( 'Connect' ) }
				</Button>
			</SettingsRow>
			{ formOpen ? (
				<form
					aria-label={ sprintf(
						/* translators: %s: provider name */
						__( '%s connection' ),
						descriptor.label
					) }
					onSubmit={ ( event ) => {
						event.preventDefault();
						if ( ! pending && ( filled || account?.connected ) ) {
							void save().catch( () => {} );
						}
					} }
				>
					{ fields.map( ( field, index ) => (
						<SettingsRow
							key={ field.name }
							title={ field.title }
							description={ field.description }
							error={
								index === fields.length - 1
									? ( connect.error ?? setProvider.error ?? disconnect.error )?.message
									: undefined
							}
							stacked
						>
							<div className={ styles.keyForm }>
								<Input
									className={ styles.apiKeyInput }
									type={ field.secret ? 'password' : 'text' }
									autoComplete="off"
									aria-label={ field.title }
									placeholder={ ( field.secret && account?.summary ) || field.placeholder }
									value={ values[ field.name ] ?? '' }
									disabled={ pending }
									onChange={ ( event ) =>
										setValues( { ...values, [ field.name ]: event.target.value } )
									}
								/>
								{ index === fields.length - 1 ? (
									<>
										<Button
											variant="accent"
											type="submit"
											disabled={ pending || ( ! filled && ! account?.connected ) }
											loading={ connect.isPending || setProvider.isPending }
											loadingAnnouncement={ __( 'Saving' ) }
										>
											{ __( 'Save' ) }
										</Button>
										{ account?.connected ? (
											<Button
												variant="outline"
												disabled={ pending }
												onClick={ () => disconnect.mutate( undefined, { onSuccess: closeForm } ) }
											>
												{ __( 'Disconnect' ) }
											</Button>
										) : null }
									</>
								) : null }
							</div>
						</SettingsRow>
					) ) }
				</form>
			) : null }
		</>
	);
}

function ProvidersSection( { onManageCredits }: { onManageCredits: () => void } ) {
	const settings = useAiSettings();
	const { data: user, isLoading: userLoading } = useAuthUser();
	const origin = getProviderIntent( useConnector() );
	const { promptRef, ...signup } = useLogin( {
		signup: true,
		source: 'settings',
		analytics: {
			placement: 'settings_ai',
			intent: origin?.intent ?? 'build',
			journey_id: origin?.journey_id,
		},
		scope: origin?.scope,
		trackExposure: ! user && ! userLoading,
	} );
	const setProvider = useSetAiProvider();
	const isOffline = useOffline();
	const [ wpcomRequested, setWpcomRequested ] = useState( false );
	const connected = PROVIDER_IDS.filter( ( id ) => settings.data?.accounts[ id ].connected );

	// Connecting WordPress.com finishes once the sign-up lands.
	const { mutate: selectProvider } = setProvider;
	useEffect( () => {
		if ( wpcomRequested && user ) {
			setWpcomRequested( false );
			selectProvider( 'wpcom' );
		}
	}, [ wpcomRequested, user, selectProvider ] );

	return (
		<SettingsGroup title={ __( 'Providers' ) }>
			{ settings.isError ? (
				<SettingsRow title={ __( "Couldn't load providers." ) }>
					<Button variant="outline" onClick={ () => void settings.refetch() }>
						{ __( 'Retry' ) }
					</Button>
				</SettingsRow>
			) : null }
			<SettingsRow
				title={ __( 'WordPress.com' ) }
				badge={ user ? connectedBadge() : null }
				description={
					<>
						{ __(
							'Get started with a one-time free allowance, then buy more as you go. No API key required.'
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsAiCredits" />
					</>
				}
				error={ signup.error?.message }
			>
				<Button
					disabled={ userLoading || ( ! user && isOffline ) }
					ref={ promptRef }
					onClick={ () => {
						if ( user ) {
							onManageCredits();
							return;
						}
						setWpcomRequested( true );
						signup.mutate( undefined, { onError: () => setWpcomRequested( false ) } );
					} }
				>
					{ user ? __( 'Manage' ) : __( 'Connect' ) }
				</Button>
			</SettingsRow>
			{ PROVIDER_IDS.filter( ( id ) => getConnectFields( id ).length ).map( ( id ) => (
				<ProviderFormRow key={ id } provider={ id } />
			) ) }
			{ connected.length > 1 && settings.data ? (
				<SettingsRow
					title={ __( 'Default provider' ) }
					description={ __( 'The provider new chats use.' ) }
					error={ setProvider.error?.message }
				>
					<SettingsSelect< ProviderId >
						label={ __( 'Default provider' ) }
						value={ settings.data.provider }
						disabled={ settings.isLoading || setProvider.isPending }
						options={ connected.map( ( provider ) => ( {
							value: provider,
							label: getProviderDescriptor( provider ).label,
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
