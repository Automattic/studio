import {
	getConnectFields,
	getProvider,
	type AiProviderId,
	type ConnectMethod,
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
import { Markdown } from '@/features/chats';
import { LearnMoreLink } from '@/features/onboarding';
import { useOffline } from '@/lib/hooks';
import { ChevronDownIcon, ExternalLinkIcon } from '@/lib/icons';
import { Button, Input, Menu } from '@/lib/ui';
import { ProviderLogo } from './provider-logo';
import { connectedBadge, SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';

export function getProviderConnectMethods( id: ProviderId, loopbackSignIn: boolean ) {
	return getProvider( id ).account.methods.filter(
		( { kind } ) =>
			kind !== 'redirect' && ( loopbackSignIn || ( kind !== 'loopback' && kind !== 'device' ) )
	);
}

// A provider's row: the ways its account connects, as a button or a menu, a form for the method
// that asks for one, and where to sign in while a sign-in on its site is pending.
export function ProviderRow( {
	provider,
	methods,
}: {
	provider: ProviderId;
	methods: ConnectMethod[];
} ) {
	const settings = useAiSettings();
	const connect = useConnectProvider( provider );
	const disconnect = useDisconnectProvider( provider );
	const offline = useOffline();
	const descriptor = getProvider( provider );
	const account = settings.data?.accounts[ provider ];
	const connectedMethod = account?.connected ? account.method : undefined;
	const [ formMethod, setFormMethod ] = useState< ConnectMethod >();
	const [ values, setValues ] = useState< Record< string, string > >( {} );
	const fields = formMethod ? getConnectFields( formMethod ) : [];
	const instructions = formMethod?.instructions?.();
	// The account is connected with the form being shown.
	const current = formMethod !== undefined && formMethod.id === connectedMethod;
	const signingIn = connect.isPending && connect.pending !== null;
	// A sign-in waiting on the browser doesn't block connecting another way.
	const pending =
		settings.isLoading || ( connect.isPending && ! signingIn ) || disconnect.isPending;
	const filled = fields.every( ( field ) => values[ field.name ]?.trim() );
	const [ onlyMethod ] = methods;
	const error = ( connect.error ?? disconnect.error )?.message;

	const closeForm = () => {
		setValues( {} );
		setFormMethod( undefined );
	};
	const pick = ( method: ConnectMethod ) => {
		if ( method.kind === 'form' ) {
			setFormMethod( method );
			return;
		}
		closeForm();
		connect.mutate( { method: method.id } );
	};
	const save = async () => {
		await connect.mutateAsync( { method: formMethod!.id, input: values } );
		closeForm();
	};

	let control;
	if ( methods.length > 1 && ! formMethod ) {
		control = (
			<Menu.Root>
				<Menu.Trigger render={ <Button variant="outline" disabled={ pending } /> }>
					{ account?.connected ? __( 'Manage' ) : __( 'Connect' ) }
					<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
				</Menu.Trigger>
				<Menu.Popup side="bottom" align="end">
					<Menu.RadioGroup value={ connectedMethod ?? '' }>
						{ methods.map( ( method ) => (
							<Menu.RadioItem
								key={ method.id }
								value={ method.id }
								onClick={ () => pick( method ) }
							>
								{ method.label() }
							</Menu.RadioItem>
						) ) }
					</Menu.RadioGroup>
					{ account?.connected ? (
						<Menu.Item onClick={ () => disconnect.mutate() }>{ __( 'Disconnect' ) }</Menu.Item>
					) : null }
				</Menu.Popup>
			</Menu.Root>
		);
	} else if ( onlyMethod.kind === 'form' || formMethod ) {
		control = (
			<Button
				className={ styles.providerFormToggle }
				variant="outline"
				aria-expanded={ !! formMethod }
				disabled={ pending }
				onClick={ () => ( formMethod ? closeForm() : pick( onlyMethod ) ) }
			>
				{ account?.connected ? __( 'Manage' ) : __( 'Connect' ) }
				<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
			</Button>
		);
	} else if ( account?.connected ) {
		control = (
			<Button
				variant="outline"
				disabled={ disconnect.isPending }
				onClick={ () => disconnect.mutate() }
			>
				{ __( 'Disconnect' ) }
			</Button>
		);
	} else {
		control = (
			<Button
				className={ styles.externalConnect }
				variant="outline"
				disabled={ settings.isLoading || offline }
				loading={ connect.isPending && ! signingIn }
				onClick={ () => pick( onlyMethod ) }
			>
				{ /* Signing in again starts over, for when the browser tab was closed. */ }
				{ signingIn ? __( 'Try again' ) : __( 'Connect' ) }
				<ExternalLinkIcon data-icon="inline-end" />
			</Button>
		);
	}

	let description;
	if ( signingIn && ! formMethod && connect.pending?.code ) {
		description = sprintf(
			/* translators: 1: a sign-in code, 2: a service name such as Spacefast */
			__( 'Approve the code %1$s on %2$s to connect.' ),
			connect.pending.code,
			descriptor.label
		);
	} else if ( signingIn && ! formMethod ) {
		description = sprintf(
			/* translators: %s: a service name such as ChatGPT */
			__( 'Finish signing in to %s in your browser.' ),
			descriptor.label
		);
	} else {
		description = descriptor.description?.();
	}

	return (
		<>
			<SettingsRow
				title={ descriptor.label }
				settingId={ `${ provider }-provider` }
				icon={ <ProviderLogo provider={ provider } /> }
				badge={ account?.connected ? connectedBadge() : null }
				description={ description }
				error={ formMethod ? undefined : error }
			>
				{ control }
			</SettingsRow>
			{ formMethod ? (
				<form
					className={ styles.connectForm }
					aria-label={ sprintf(
						/* translators: %s: provider name */
						__( '%s connection' ),
						descriptor.label
					) }
					onSubmit={ ( event ) => {
						event.preventDefault();
						if ( ! pending && filled ) {
							void save().catch( () => {} );
						}
					} }
				>
					{ instructions ? (
						<SettingsRow title={ __( 'How to connect' ) } stacked>
							<div className={ styles.connectInstructions }>
								<Markdown>{ instructions }</Markdown>
							</div>
						</SettingsRow>
					) : null }
					{ fields.map( ( field, index ) => (
						<SettingsRow
							key={ field.name }
							title={ field.title }
							description={ field.description }
							error={ index === fields.length - 1 ? error : undefined }
							stacked
						>
							<div className={ styles.keyForm }>
								<Input
									className={ styles.apiKeyInput }
									type={ field.secret ? 'password' : 'text' }
									autoComplete="off"
									aria-label={ field.title }
									placeholder={
										( field.secret && current && account?.connected && account.summary ) ||
										field.placeholder
									}
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
											disabled={ pending || ! filled }
											loading={ connect.isPending && ! signingIn }
											loadingAnnouncement={ __( 'Saving' ) }
										>
											{ __( 'Save' ) }
										</Button>
										{ account?.connected && methods.length === 1 ? (
											<Button
												variant="outline"
												disabled={ pending }
												onClick={ () => disconnect.mutate( undefined, { onSuccess: closeForm } ) }
											>
												{ __( 'Disconnect' ) }
											</Button>
										) : (
											<Button variant="outline" disabled={ pending } onClick={ closeForm }>
												{ __( 'Cancel' ) }
											</Button>
										) }
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
	const connector = useConnector();
	const origin = getProviderIntent( connector );
	const { loopbackSignIn } = connector.capabilities;
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
			{ providers
				.filter( ( id ) => id !== 'wpcom' )
				.map( ( id ) => (
					<ProviderRow
						key={ id }
						provider={ id }
						methods={ getProviderConnectMethods( id, loopbackSignIn ) }
					/>
				) ) }
		</SettingsGroup>
	);
}
