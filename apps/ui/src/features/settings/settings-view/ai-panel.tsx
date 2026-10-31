import { AI_PROVIDER_LABELS } from '@studio/agent/protocol/providers';
import { __ } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
	useAiSettings,
	useSaveAnthropicApiKey,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import {
	useSpacefastLogin,
	useSpacefastLogout,
	useSpacefastSignedIn,
} from '@/data/queries/use-spacefast';
import { LearnMoreLink } from '@/features/onboarding';
import { useOffline } from '@/lib/hooks';
import { Badge, Button, Input } from '@/lib/ui';
import { SettingsGroup, SettingsRow, SettingsSelect } from './rows';
import styles from './style.module.css';
import type { AiProviderId } from '@studio/agent/protocol/providers';

const connectedBadge = () => (
	<Badge size="xs" variant="accent">
		<CheckIcon aria-hidden="true" />
		{ __( 'Connected' ) }
	</Badge>
);

function ProvidersSection( { onManageCredits }: { onManageCredits: () => void } ) {
	const settings = useAiSettings();
	const { data: user, isLoading: userLoading } = useAuthUser();
	const signup = useLogin( { signup: true, source: 'settings' } );
	const setProvider = useSetAiProvider();
	const saveKey = useSaveAnthropicApiKey();
	const isOffline = useOffline();
	const [ wpcomRequested, setWpcomRequested ] = useState( false );
	const [ keyFormOpen, setKeyFormOpen ] = useState( false );
	const [ key, setKey ] = useState( '' );
	const hasKey = !! settings.data?.hasAnthropicApiKey;
	const pending = settings.isLoading || saveKey.isPending || setProvider.isPending;

	// Connecting WordPress.com finishes once the sign-up lands.
	const { mutate: selectProvider } = setProvider;
	useEffect( () => {
		if ( wpcomRequested && user ) {
			setWpcomRequested( false );
			selectProvider( 'wpcom' );
		}
	}, [ wpcomRequested, user, selectProvider ] );

	const closeKeyForm = () => {
		setKey( '' );
		setKeyFormOpen( false );
	};
	const connectKey = async () => {
		if ( key.trim() ) {
			await saveKey.mutateAsync( key.trim() );
		}
		await setProvider.mutateAsync( 'anthropic-api-key' );
		closeKeyForm();
	};

	return (
		<SettingsGroup title={ __( 'Providers' ) }>
			{ settings.isError ? (
				<SettingsRow title={ __( "Couldn't load AI providers." ) }>
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
					loading={ signup.isPending }
					loadingAnnouncement={ __( 'Connecting' ) }
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
			<SettingsRow
				title={ __( 'Anthropic' ) }
				badge={ hasKey ? connectedBadge() : null }
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
					onClick={ () => ( keyFormOpen ? closeKeyForm() : setKeyFormOpen( true ) ) }
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
						error={ ( saveKey.error ?? setProvider.error )?.message }
						stacked
					>
						<div className={ styles.keyForm }>
							<Input
								className={ styles.apiKeyInput }
								type="password"
								autoComplete="off"
								aria-label={ __( 'Anthropic API key' ) }
								placeholder={ settings.data?.anthropicApiKeyPreview ?? 'sk-…' }
								value={ key }
								disabled={ pending }
								onChange={ ( event ) => setKey( event.target.value ) }
							/>
							<Button
								type="submit"
								disabled={ pending || ( ! key.trim() && ! hasKey ) }
								loading={ saveKey.isPending || setProvider.isPending }
								loadingAnnouncement={ __( 'Saving' ) }
							>
								{ __( 'Save' ) }
							</Button>
							{ hasKey ? (
								<Button
									variant="outline"
									disabled={ pending }
									onClick={ () => saveKey.mutate( null, { onSuccess: closeKeyForm } ) }
								>
									{ __( 'Remove key' ) }
								</Button>
							) : null }
						</div>
					</SettingsRow>
				</form>
			) : null }
			{ hasKey && settings.data ? (
				<SettingsRow
					title={ __( 'Default provider' ) }
					description={ __( 'The provider new chats use.' ) }
					error={ keyFormOpen ? undefined : setProvider.error?.message }
				>
					<SettingsSelect< AiProviderId >
						label={ __( 'Default provider' ) }
						value={ settings.data.provider }
						disabled={ pending }
						options={ ( [ 'wpcom', 'anthropic-api-key' ] as const ).map( ( provider ) => ( {
							value: provider,
							label: AI_PROVIDER_LABELS[ provider ],
						} ) ) }
						onChange={ ( provider ) => setProvider.mutate( provider ) }
					/>
				</SettingsRow>
			) : null }
		</SettingsGroup>
	);
}

function PublishingSection() {
	const signedIn = useSpacefastSignedIn();
	const login = useSpacefastLogin();
	const logout = useSpacefastLogout();
	const isOffline = useOffline();
	const connected = !! signedIn.data;
	return (
		<SettingsGroup title={ __( 'Publishing' ) }>
			<SettingsRow
				title={ __( 'Spacefast' ) }
				badge={ connected ? connectedBadge() : null }
				description={ __( 'Publish a static copy of your sites to a Spacefast Space.' ) }
				error={ ( login.error ?? logout.error )?.message }
			>
				<Button
					variant="outline"
					disabled={ signedIn.isLoading || logout.isPending || ( ! connected && isOffline ) }
					loading={ login.isPending }
					loadingAnnouncement={ __( 'Waiting for approval' ) }
					onClick={ () => ( connected ? logout.mutate() : login.mutate() ) }
				>
					{ connected ? __( 'Disconnect' ) : __( 'Connect' ) }
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}

export function AiPanel( { onManageCredits }: { onManageCredits: () => void } ) {
	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup>
				<SettingsRow
					title={ __( 'AI providers' ) }
					description={
						<>
							{ __(
								'AI providers give WordPress Studio access to the models that understand your requests and make changes to your sites. Connect one to build pages, write content, and customize themes and plugins through chat.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsStudioCode" />
						</>
					}
				/>
			</SettingsGroup>
			<ProvidersSection onManageCredits={ onManageCredits } />
			<PublishingSection />
		</div>
	);
}
