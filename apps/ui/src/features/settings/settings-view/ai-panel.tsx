import {
	AI_PROVIDER_IDS,
	getConnectFields,
	getProvider,
	type AiProviderId,
	type ConnectMethod,
	type ProviderId,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { getProviderIntent } from '@/data/account-analytics';
import { useConnector } from '@/data/core';
import {
	useAiSettings,
	useConnectProvider,
	useDisconnectProvider,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { usePublishProviders } from '@/data/queries/use-remote-sites';
import { ProviderLogo } from '@/features/account';
import { Markdown } from '@/features/chats';
import { LearnMoreLink } from '@/features/onboarding';
import { useOffline } from '@/lib/hooks';
import { ChevronDownIcon } from '@/lib/icons';
import { Button, Input, Menu } from '@/lib/ui';
import { connectedBadge, SettingsGroup, SettingsRow, SettingsSelect } from './rows';
import styles from './style.module.css';

// A provider's row: the ways its account connects, as a button or a menu, a form for the method
// that asks for one, and where to sign in while a sign-in on its site is pending.
function ProviderRow( { provider, methods }: { provider: ProviderId; methods: ConnectMethod[] } ) {
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
					<ChevronDownIcon />
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
				variant="outline"
				aria-expanded={ !! formMethod }
				disabled={ pending }
				onClick={ () => ( formMethod ? closeForm() : pick( onlyMethod ) ) }
			>
				{ account?.connected ? __( 'Manage' ) : __( 'Connect' ) }
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
				variant="outline"
				disabled={ settings.isLoading || offline }
				loading={ connect.isPending && ! signingIn }
				onClick={ () => pick( onlyMethod ) }
			>
				{ /* Signing in again starts over, for when the browser tab was closed. */ }
				{ signingIn ? __( 'Try again' ) : onlyMethod.label() }
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
		description = (
			<>
				{ descriptor.description?.() }{ ' ' }
				{ descriptor.learnMoreUrl ? <LearnMoreLink url={ descriptor.learnMoreUrl } /> : null }
			</>
		);
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
	const isOffline = useOffline();
	const { capabilities } = useConnector();
	// The Studio sign-in has a row of its own; the others connect the ways this app supports.
	const providers = [ ...new Set( [ ...AI_PROVIDER_IDS, ...usePublishProviders() ] ) ]
		.map( ( id ) => ( {
			id,
			methods: getProvider( id ).account.methods.filter(
				( { kind } ) =>
					kind !== 'redirect' &&
					( capabilities.loopbackSignIn || ( kind !== 'loopback' && kind !== 'device' ) )
			),
		} ) )
		.filter( ( { methods } ) => methods.length );

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
				title={ getProvider( 'wpcom' ).label }
				icon={ <ProviderLogo provider="wpcom" /> }
				badge={ user ? connectedBadge() : null }
				description={
					<>
						{ getProvider( 'wpcom' ).description?.() }{ ' ' }
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
						signup.mutate();
					} }
				>
					{ user ? __( 'Manage' ) : __( 'Connect' ) }
				</Button>
			</SettingsRow>
			{ providers.map( ( { id, methods } ) => (
				<ProviderRow key={ id } provider={ id } methods={ methods } />
			) ) }
		</SettingsGroup>
	);
}

function DefaultProviderGroup() {
	const settings = useAiSettings();
	const setProvider = useSetAiProvider();
	const connected = AI_PROVIDER_IDS.filter( ( id ) => settings.data?.accounts[ id ].connected );

	if ( connected.length < 2 || ! settings.data ) {
		return null;
	}

	return (
		<SettingsGroup>
			<SettingsRow
				title={ __( 'Default AI provider' ) }
				description={ __( 'The provider new chats use.' ) }
				error={ setProvider.error?.message }
			>
				<SettingsSelect< AiProviderId >
					label={ __( 'Default AI provider' ) }
					value={ settings.data.provider }
					disabled={ settings.isLoading || setProvider.isPending }
					options={ connected.map( ( provider ) => ( {
						value: provider,
						label: getProvider( provider ).label,
					} ) ) }
					onChange={ ( provider ) => setProvider.mutate( provider ) }
				/>
			</SettingsRow>
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
								'Providers give WordPress Studio access to the models that understand your requests and make changes to your sites, and to the places you publish them. Connect one to build pages, write content, and customize themes and plugins through chat.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsStudioCode" />
						</>
					}
				/>
			</SettingsGroup>
			<ProvidersSection onManageCredits={ onManageCredits } />
			<DefaultProviderGroup />
		</div>
	);
}
