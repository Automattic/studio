import { getProvider } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useAiSettings, useSetAiProvider } from '@/data/queries/use-ai-settings';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useConnectedHostingProviders, usePublishProviders } from '@/data/queries/use-remote-sites';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SETTINGS_AI_PROVIDER_IDS } from '@/data/settings-sections';
import { LearnMoreLink } from '@/features/onboarding';
import { useOffline } from '@/lib/hooks';
import { ExternalLinkIcon } from '@/lib/icons';
import { Button } from '@/lib/ui';
import { AiProviders, getProviderConnectMethods, ProviderRow } from './ai-panel';
import { ProviderLogo } from './provider-logo';
import { connectedBadge, SettingsGroup, SettingsRow, SettingsSelect } from './rows';
import { SpacefastProviderRow, type SpacefastConnectControl } from './spacefast-provider-row';
import styles from './style.module.css';
import type { AiProviderId, ProviderId, SitesProviderId } from '@studio/providers';

function DefaultProviderRow< Id extends ProviderId >( {
	title,
	description,
	settingId,
	connected,
	value,
	loading,
	disabled,
	error,
	onChange,
}: {
	title: string;
	description: string;
	settingId: string;
	connected: Id[];
	value: Id | null;
	loading: boolean;
	disabled: boolean;
	error?: string;
	onChange: ( value: Id ) => void;
} ) {
	const onlyProvider = connected.length === 1 ? connected[ 0 ] : undefined;
	const hasProviders = connected.length > 0;
	const placeholder = hasProviders
		? __( 'Choose a provider' )
		: loading
		? __( 'Loading…' )
		: __( 'No providers' );

	return (
		<SettingsRow
			title={ title }
			description={ description }
			settingId={ settingId }
			error={ error }
		>
			<SettingsSelect
				label={ title }
				value={ onlyProvider ?? value }
				placeholder={ placeholder }
				disabled={ disabled || ! hasProviders }
				options={ connected.map( ( id ) => ( {
					value: id,
					label: getProvider( id ).label,
					icon: (
						<span className={ styles.providerSelectIcon } aria-hidden="true">
							<ProviderLogo provider={ id } />
						</span>
					),
				} ) ) }
				onChange={ onChange }
			/>
		</SettingsRow>
	);
}

function ProviderDefaults( {
	aiProviders,
	hostingProviders,
}: {
	aiProviders: AiProviderId[];
	hostingProviders: SitesProviderId[];
} ) {
	const settings = useAiSettings();
	const hosting = useConnectedHostingProviders( hostingProviders );
	const setAiProvider = useSetAiProvider();
	const preferences = useUserPreferences();
	const save = useSaveUserPreferences();

	return (
		<SettingsGroup>
			<DefaultProviderRow
				title={ __( 'Default AI provider' ) }
				description={ __( 'For working on sites.' ) }
				settingId="default-provider"
				connected={ aiProviders.filter( ( id ) => settings.data?.accounts[ id ].connected ) }
				value={ settings.data?.provider ?? null }
				loading={ settings.isPending }
				disabled={ setAiProvider.isPending }
				error={ setAiProvider.error?.message }
				onChange={ ( provider ) => setAiProvider.mutate( provider ) }
			/>
			<DefaultProviderRow
				title={ __( 'Default hosting provider' ) }
				description={ __( 'For publishing sites.' ) }
				settingId="default-hosting-provider"
				connected={ hosting.connected }
				value={ preferences.data?.defaultHostingProvider ?? null }
				loading={ hosting.isPending }
				disabled={ ! preferences.data || save.isPending }
				error={ ( save.error ?? preferences.error )?.message }
				onChange={ ( defaultHostingProvider ) => save.mutate( { defaultHostingProvider } ) }
			/>
		</SettingsGroup>
	);
}

function HostingProviders( {
	providers,
	spacefast,
}: {
	providers: SitesProviderId[];
	spacefast: SpacefastConnectControl;
} ) {
	const auth = useAuthUser();
	const login = useLogin( { source: 'settings' } );
	const offline = useOffline();
	const { loopbackSignIn } = useConnector().capabilities;

	return (
		<SettingsGroup
			title={ __( 'Hosting providers' ) }
			settingId="hosting-providers"
			description={
				<>
					{ __( 'Publish your site when it’s ready, or share a preview through WordPress.com.' ) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsHostingProviders" />
				</>
			}
		>
			{ providers.map( ( id ) =>
				id === 'wpcom' ? (
					<SettingsRow
						key={ id }
						title={ getProvider( id ).label }
						settingId="wpcom-hosting"
						icon={ <ProviderLogo provider={ id } /> }
						description={ __(
							'Publish new sites or update existing ones on WordPress.com or Pressable.'
						) }
						badge={ auth.data ? connectedBadge() : null }
						error={ login.error?.message }
					>
						{ ! auth.data ? (
							<Button
								className={ styles.externalConnect }
								variant="outline"
								aria-label={ __( 'Connect to WordPress.com' ) }
								disabled={ auth.isPending || login.isPending || offline }
								onClick={ () => login.mutate() }
							>
								{ __( 'Connect' ) }
								<ExternalLinkIcon data-icon="inline-end" />
							</Button>
						) : null }
					</SettingsRow>
				) : id === 'spacefast' ? (
					<SpacefastProviderRow key={ id } { ...spacefast } />
				) : (
					<ProviderRow
						key={ id }
						provider={ id }
						methods={ getProviderConnectMethods( id, loopbackSignIn ) }
					/>
				)
			) }
		</SettingsGroup>
	);
}

export function ProvidersPanel( {
	onManageCredits,
	spacefast,
}: {
	onManageCredits: () => void;
	spacefast: SpacefastConnectControl;
} ) {
	const { loopbackSignIn } = useConnector().capabilities;
	const aiProviders = SETTINGS_AI_PROVIDER_IDS.filter(
		( id ) => id === 'wpcom' || getProviderConnectMethods( id, loopbackSignIn ).length > 0
	);
	const hostingProviders = usePublishProviders().filter(
		( id ) => id === 'wpcom' || getProviderConnectMethods( id, loopbackSignIn ).length > 0
	);

	return (
		<div className={ styles.preferencesPanel }>
			<ProviderDefaults aiProviders={ aiProviders } hostingProviders={ hostingProviders } />
			<AiProviders providers={ aiProviders } onManageCredits={ onManageCredits } />
			<HostingProviders providers={ hostingProviders } spacefast={ spacefast } />
		</div>
	);
}
