import {
	getConnectFields,
	getProviderDescriptor,
	normalizeAiProviderId,
	type AiProviderId,
	type ProviderId,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { getProviderIntent } from '@/data/account-analytics';
import { useConnector } from '@/data/core';
import {
	useAiSettings,
	useConnectProvider,
	useSignIn,
	useDisconnectProvider,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { LearnMoreLink } from '@/features/onboarding';
import { useOffline } from '@/lib/hooks';
import { ChevronDownIcon, ExternalLinkIcon } from '@/lib/icons';
import { Button, Input } from '@/lib/ui';
import { ProviderLogo } from './provider-logo';
import { connectedBadge, SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';

// A provider that connects with a form: the form comes from its descriptor.
function ProviderFormRow( { provider }: { provider: AiProviderId } ) {
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
				icon={ <ProviderLogo provider={ provider } /> }
				badge={ account?.connected ? connectedBadge() : null }
				description={ descriptor.description?.() }
			>
				<Button
					className={ styles.providerFormToggle }
					variant="outline"
					aria-expanded={ formOpen }
					disabled={ pending }
					onClick={ () => ( formOpen ? closeForm() : setFormOpen( true ) ) }
				>
					{ account?.connected ? __( 'Manage' ) : __( 'Connect' ) }
					<ChevronDownIcon data-icon="inline-end" />
				</Button>
			</SettingsRow>
			{ formOpen ? (
				<form
					className={ styles.providerForm }
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

export function AiProviders( {
	providers,
	onManageCredits,
}: {
	providers: AiProviderId[];
	onManageCredits: () => void;
} ) {
	const settings = useAiSettings();
	const { data: user, isLoading: userLoading } = useAuthUser();
	const origin = getProviderIntent( useConnector() );
	const { promptRef, ...login } = useLogin( {
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

	// Connecting WordPress.com finishes once the sign-in lands.
	const { mutate: selectProvider } = setProvider;
	useEffect( () => {
		if ( wpcomRequested && user ) {
			setWpcomRequested( false );
			selectProvider( 'wpcom' );
		}
	}, [ wpcomRequested, user, selectProvider ] );

	return (
		<SettingsGroup
			title={ __( 'AI providers' ) }
			settingId="ai-providers"
			description={
				<>
					{ __(
						'Build and edit sites through chat. Use WordPress.com AI credits or bring your own subscription or API key.'
					) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsAiProviders" />
				</>
			}
		>
			{ settings.isError ? (
				<SettingsRow title={ __( "Couldn't load providers." ) }>
					<Button variant="outline" onClick={ () => void settings.refetch() }>
						{ __( 'Retry' ) }
					</Button>
				</SettingsRow>
			) : null }
			<SettingsRow
				title={ __( 'WordPress.com' ) }
				settingId="wpcom-provider"
				icon={ <ProviderLogo provider="wpcom" /> }
				badge={ user ? connectedBadge() : null }
				description={ __( 'Start building with free AI credits.' ) }
				error={ login.error?.message }
			>
				<Button
					className={ styles.externalConnect }
					disabled={ userLoading || ( ! user && isOffline ) }
					ref={ promptRef }
					aria-label={ user ? undefined : __( 'Connect to WordPress.com' ) }
					onClick={ () => {
						if ( user ) {
							onManageCredits();
							return;
						}
						setWpcomRequested( true );
						login.mutate( undefined, { onError: () => setWpcomRequested( false ) } );
					} }
				>
					{ user ? __( 'Manage AI credits' ) : __( 'Connect' ) }
					{ ! user ? <ExternalLinkIcon data-icon="inline-end" /> : null }
				</Button>
			</SettingsRow>
			{ providers.map( ( id ) => {
				const { kind } = getProviderDescriptor( id ).connection;
				if ( kind === 'device' || kind === 'loopback' ) {
					return <SignInProviderRow key={ id } provider={ id } />;
				}
				return getConnectFields( id ).length ? (
					<ProviderFormRow key={ id } provider={ id } />
				) : null;
			} ) }
		</SettingsGroup>
	);
}

// A provider that connects by signing in on its site, with a code or in the browser.
export function SignInProviderRow( { provider }: { provider: ProviderId } ) {
	const settings = useAiSettings();
	const signIn = useSignIn( provider );
	const setProvider = useSetAiProvider();
	const disconnect = useDisconnectProvider( provider );
	const offline = useOffline();
	const descriptor = getProviderDescriptor( provider );
	const connected = settings.data?.accounts[ provider ].connected;
	// Signing in again starts over, for when the browser tab was closed.
	const inBrowser = signIn.isPending && descriptor.connection.kind === 'loopback';
	return (
		<SettingsRow
			title={ descriptor.label }
			settingId={ `${ provider }-provider` }
			icon={ <ProviderLogo provider={ provider } /> }
			badge={ connected ? connectedBadge() : null }
			description={
				signIn.authorization
					? sprintf(
							/* translators: 1: a sign-in code, 2: a service name such as Spacefast */
							__( 'Approve the code %1$s on %2$s to connect.' ),
							signIn.authorization.userCode,
							descriptor.label
					  )
					: inBrowser
					? sprintf(
							/* translators: %s: a service name such as ChatGPT */
							__( 'Finish signing in to %s in your browser.' ),
							descriptor.label
					  )
					: descriptor.description?.()
			}
			error={ ( signIn.error ?? setProvider.error ?? disconnect.error )?.message }
		>
			{ connected ? (
				<Button
					variant="outline"
					disabled={ disconnect.isPending }
					onClick={ () => disconnect.mutate() }
				>
					{ __( 'Disconnect' ) }
				</Button>
			) : (
				<Button
					className={ styles.externalConnect }
					variant="outline"
					disabled={ settings.isLoading || offline }
					loading={ signIn.isPending && ! inBrowser }
					onClick={ () =>
						signIn.mutate( undefined, {
							// Connecting a chat provider selects it, as saving a form does.
							onSuccess: () => {
								const id = normalizeAiProviderId( provider );
								if ( id ) {
									setProvider.mutate( id );
								}
							},
						} )
					}
				>
					{ inBrowser ? __( 'Try again' ) : __( 'Connect' ) }
					<ExternalLinkIcon data-icon="inline-end" />
				</Button>
			) }
		</SettingsRow>
	);
}
