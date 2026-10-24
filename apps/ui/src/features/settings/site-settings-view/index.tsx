import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	decodeAdminPassword,
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import { getSiteFileAccess } from '@studio/common/lib/site-file-access';
import { getWpEnvironmentType } from '@studio/common/lib/wp-environment-type';
import {
	getClosestSupportedPhpVersion,
	RecommendedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useDebugLogExists } from '@/data/queries/use-debug-log';
import { useIsSiteBusy, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { CopyButton } from '@/features/chats';
import { LearnMoreLink } from '@/features/settings/learn-more';
import { useSettingsDialog } from '@/features/settings/settings-dialog/context';
import { ConnectionCard } from '@/features/settings/settings-view/account-section';
import { SettingsGroup, SettingsRow, SettingsToggle } from '@/features/settings/settings-view/rows';
import {
	CertificateTrustNotice,
	getEnvironmentTypeOptions,
	getFileAccessOptions,
	getPhpVersionOptions,
	getWpVersionOptions,
	SiteSelect,
	validateAdminPassword,
	validateSiteName,
} from '@/features/sites';
import { useOffline } from '@/lib/hooks';
import { Button, IconButton, Input } from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { SiteSettingsSectionId } from '@/features/settings/settings-dialog/context';
import type { DocsLinkKey } from '@studio/common/lib/docs-links';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { WpEnvironmentType } from '@studio/common/lib/wp-environment-type';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { ComponentProps, FormEvent, ReactNode } from 'react';

interface FormData {
	name: string;
	phpVersion: SupportedPHPVersion;
	fileAccess: SiteFileAccess;
	// Empty string means "auto-update"; anything else pins the site to that
	// version. Only forwarded on save when the user actually changed it.
	wpVersion: string;
	useCustomDomain: boolean;
	customDomain: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
	enableXdebug: boolean;
	enableDebugLog: boolean;
	enableDebugDisplay: boolean;
	enableScriptDebug: boolean;
	environmentType: WpEnvironmentType;
}

function getEffectiveWpVersion( site: SiteDetails, installedVersion?: string ): string {
	// Mirrors the legacy apps/studio behavior: sites created before the auto-
	// updating flag existed count as auto-updating too.
	if ( site.isWpAutoUpdating !== false ) {
		return '';
	}
	return installedVersion && installedVersion !== '-'
		? installedVersion
		: DEFAULT_WORDPRESS_VERSION;
}

function initialFormData( site: SiteDetails, installedWpVersion?: string ): FormData {
	return {
		name: site.name,
		phpVersion: ( site.phpVersion as SupportedPHPVersion ) ?? RecommendedPHPVersion,
		fileAccess: getSiteFileAccess( site ),
		wpVersion: getEffectiveWpVersion( site, installedWpVersion ),
		useCustomDomain: Boolean( site.customDomain ),
		customDomain: site.customDomain ?? '',
		enableHttps: site.enableHttps ?? false,
		adminUsername: site.adminUsername ?? DEFAULT_ADMIN_USERNAME,
		adminPassword: decodeAdminPassword( site.adminPassword ),
		adminEmail: site.adminEmail || DEFAULT_ADMIN_EMAIL,
		enableXdebug: site.enableXdebug ?? false,
		enableDebugLog: site.enableDebugLog ?? false,
		enableDebugDisplay: site.enableDebugDisplay ?? false,
		enableScriptDebug: site.enableScriptDebug ?? false,
		environmentType: getWpEnvironmentType( site ),
	};
}

const FORM_ID = 'site-settings-form';

type TextKey = 'name' | 'customDomain' | 'adminUsername' | 'adminPassword' | 'adminEmail';
type ToggleKey =
	| 'useCustomDomain'
	| 'enableHttps'
	| 'enableXdebug'
	| 'enableDebugLog'
	| 'enableDebugDisplay'
	| 'enableScriptDebug';

/**
 * The site settings form, one section at a time. One instance spans every
 * section so unsaved edits survive switching between them; its Discard and
 * Save buttons sit in the settings dialog's header.
 */
export function SiteSettingsForm( {
	site,
	section,
}: {
	site: SiteDetails;
	section: SiteSettingsSectionId;
} ) {
	const dialog = useSettingsDialog();
	const allDomains = useExistingCustomDomains();
	const existingDomainNames = useMemo(
		() => allDomains.filter( ( domain ) => domain !== site.customDomain ),
		[ allDomains, site.customDomain ]
	);
	const xdebugEnabledSite = useXdebugEnabledSite();
	const xdebugConflictSiteName =
		xdebugEnabledSite && xdebugEnabledSite.id !== site.id ? xdebugEnabledSite.name : undefined;

	const connector = useConnector();
	const updateSite = useUpdateSite();
	const { data: logExists } = useDebugLogExists( site.id );
	const handleOpenLog = useCallback( () => {
		void connector.openSiteDebugLog( site.id ).catch( ( error ) => {
			// The file can vanish between the check and the click.
			console.error( 'Failed to open debug log:', error );
		} );
	}, [ connector, site.id ] );
	const { data: wpVersions } = useWordPressVersions();
	const { data: installedWpVersion } = useWpVersion( site.id );
	const isOffline = useOffline();
	const [ submitError, setSubmitError ] = useState< string | null >( null );
	const [ isPasswordVisible, setIsPasswordVisible ] = useState( false );

	const [ data, setData ] = useState< FormData >( () =>
		initialFormData( site, installedWpVersion )
	);
	// Re-seed the form when the underlying site changes — e.g. after a save,
	// or after another window edits it — or when the installed WordPress
	// version loads. React Query returns a new `site` reference on every
	// refetch, so object identity is enough.
	//
	// Skipped while a save is in flight: editing a site restarts it, and those
	// restart events refresh `site` before the edit has landed on disk, which
	// would momentarily seed the form with pre-save values.
	const isSaving = updateSite.isPending;
	useEffect( () => {
		if ( isSaving ) {
			return;
		}
		setData( initialFormData( site, installedWpVersion ) );
	}, [ site, installedWpVersion, isSaving ] );

	// Kept out of the effect above so a failed save's error survives the
	// save finishing; it clears once the site itself changes.
	useEffect( () => {
		setSubmitError( null );
	}, [ site ] );

	const currentWpVersion =
		installedWpVersion && installedWpVersion !== '-' ? installedWpVersion : undefined;
	const wpVersionOptions =
		getWpVersionOptions( wpVersions, {
			latestValue: '',
			currentVersion: currentWpVersion,
			// Current selection, not `site.isWpAutoUpdating`: the persisted flag
			// lags a save by a site-updated event, which would drop the version
			// from the label right after switching to auto-update.
			autoUpdateVersion: data.wpVersion === '' ? installedWpVersion : undefined,
			offline: isOffline,
		} ) ?? [];

	const errors: Partial< Record< TextKey, string > > = {
		name: validateSiteName( data.name ),
		customDomain: getDomainNameValidationError(
			data.useCustomDomain,
			data.customDomain || generateCustomDomainFromSiteName( data.name ),
			existingDomainNames
		),
		adminUsername: validateAdminUsername( data.adminUsername ),
		adminPassword: validateAdminPassword( data.adminPassword ),
		adminEmail: validateAdminEmail( data.adminEmail ),
	};
	const isValid = ! Object.values( errors ).some( Boolean );

	const handleChange = useCallback( ( update: Partial< FormData > ) => {
		setData( ( prev ) => {
			const next: FormData = { ...prev, ...update };
			// When the user toggles custom domain on for the first time, seed
			// the input with a default derived from the current site name.
			if ( ! prev.useCustomDomain && next.useCustomDomain && ! next.customDomain ) {
				next.customDomain = generateCustomDomainFromSiteName( next.name );
			}
			return next;
		} );
	}, [] );

	const initial = useMemo(
		() => initialFormData( site, installedWpVersion ),
		[ site, installedWpVersion ]
	);
	const isUnchanged = useMemo(
		() =>
			( Object.keys( initial ) as Array< keyof FormData > ).every(
				( key ) => initial[ key ] === data[ key ]
			),
		[ data, initial ]
	);

	// Saving restarts the server to apply a PHP/WordPress/domain change, so the
	// CLI refuses it while anything else holds the site.
	const isBusy = useIsSiteBusy( site );
	const disabled = isBusy || updateSite.isPending;
	const canSubmit = isValid && ! isUnchanged && ! disabled;

	const dirty = ! isUnchanged || updateSite.isPending;
	const { setDirty } = dialog;
	useEffect( () => setDirty( dirty ), [ dirty, setDirty ] );
	useEffect( () => () => setDirty( false ), [ setDirty ] );

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! canSubmit ) return;
		setSubmitError( null );
		const usedCustomDomain = data.useCustomDomain
			? data.customDomain || generateCustomDomainFromSiteName( data.name )
			: undefined;
		const wpPinned = data.wpVersion.trim();
		const updated: SiteDetails = {
			...site,
			name: data.name,
			phpVersion: data.phpVersion,
			fileAccess: data.fileAccess,
			isWpAutoUpdating: ! wpPinned,
			customDomain: usedCustomDomain,
			enableHttps: !! usedCustomDomain && data.enableHttps,
			adminUsername: data.adminUsername,
			adminPassword: encodePassword( data.adminPassword ),
			adminEmail: data.adminEmail,
			enableXdebug: data.enableXdebug,
			enableDebugLog: data.enableDebugLog,
			enableDebugDisplay: data.enableDebugDisplay,
			enableScriptDebug: data.enableScriptDebug,
			environmentType: data.environmentType,
		};
		// Only forward the version when the user actually changed it — same as
		// the legacy settings modal — so unrelated saves of a pinned site don't
		// trigger a WordPress reinstall. Switching back to auto-updating still
		// has to install the latest release, so the empty "auto-update" value
		// maps to DEFAULT_WORDPRESS_VERSION rather than forwarding nothing.
		const wpVersionChanged = data.wpVersion !== initial.wpVersion;
		updateSite.mutate(
			{
				site: updated,
				wpVersion: wpVersionChanged ? wpPinned || DEFAULT_WORDPRESS_VERSION : undefined,
			},
			{
				onSuccess: dialog.settle,
				onError: ( error ) => {
					setSubmitError( ( error as Error ).message ?? __( 'Unable to save changes.' ) );
				},
			}
		);
	};

	const textRow = (
		key: TextKey,
		title: string,
		description?: string,
		{ action, ...props }: ComponentProps< typeof Input > & { action?: ReactNode } = {}
	) => (
		<SettingsRow title={ title } description={ description } error={ errors[ key ] }>
			<div className={ styles.field }>
				<Input
					aria-label={ title }
					aria-invalid={ errors[ key ] ? true : undefined }
					value={ data[ key ] }
					disabled={ disabled }
					onChange={ ( event ) => handleChange( { [ key ]: event.target.value } ) }
					{ ...props }
				/>
				{ action }
			</div>
		</SettingsRow>
	);
	const toggleRow = (
		key: ToggleKey,
		title: string,
		description?: ReactNode,
		{ error, locked = false }: { error?: string; locked?: boolean } = {}
	) => (
		<SettingsRow title={ title } description={ description } error={ error }>
			<SettingsToggle
				label={ title }
				checked={ data[ key ] }
				disabled={ disabled || locked }
				onChange={ ( checked ) => handleChange( { [ key ]: checked } ) }
			/>
		</SettingsRow>
	);
	const learnMore = ( docsLinksKey: DocsLinkKey ) => (
		<>
			{ ' ' }
			<LearnMoreLink docsLinksKey={ docsLinksKey } />
		</>
	);
	const selectRow = (
		key: 'wpVersion' | 'phpVersion' | 'fileAccess' | 'environmentType',
		title: string,
		description: ReactNode,
		options: ComponentProps< typeof SiteSelect >[ 'options' ],
		locked = false
	) => (
		<SettingsRow title={ title } description={ description }>
			<SiteSelect
				size="sm"
				aria-label={ title }
				value={ data[ key ] }
				options={ options }
				disabled={ disabled || locked }
				onChange={ ( value ) => handleChange( { [ key ]: value } ) }
			/>
		</SettingsRow>
	);
	const copyButton = ( key: TextKey, label: string ) => (
		<CopyButton text={ data[ key ] } label={ label } size="icon-sm" icon="copy" />
	);

	const resolvedPhpVersion = getClosestSupportedPhpVersion( data.phpVersion ) ?? data.phpVersion;
	const phpVersionOptions = getPhpVersionOptions();
	if ( ! phpVersionOptions.some( ( option ) => option.value === data.phpVersion ) ) {
		phpVersionOptions.unshift( { value: data.phpVersion, label: data.phpVersion } );
	}

	const sections: Record< SiteSettingsSectionId, ReactNode > = {
		site: (
			<>
				<ConnectionCard />
				<SettingsGroup>
					{ textRow( 'name', __( 'Site name' ), __( 'Name shown in WordPress Studio.' ) ) }
					{ selectRow(
						'wpVersion',
						__( 'WordPress version' ),
						__( 'Choose the WordPress release for this site.' ),
						wpVersionOptions,
						isOffline
					) }
					<SettingsRow
						title={ __( 'Automatic updates' ) }
						description={ __( 'Keep WordPress updated to the latest released version.' ) }
					>
						<SettingsToggle
							label={ __( 'Automatic updates' ) }
							checked={ data.wpVersion === '' }
							disabled={ disabled || isOffline }
							onChange={ ( automatic ) =>
								handleChange( {
									wpVersion: automatic ? '' : currentWpVersion ?? DEFAULT_WORDPRESS_VERSION,
								} )
							}
						/>
					</SettingsRow>
				</SettingsGroup>
				<SettingsGroup title={ __( 'Local domain' ) }>
					{ toggleRow(
						'useCustomDomain',
						__( 'Use custom domain' ),
						<>
							{ __( 'Use a local address like my-site.local.' ) }
							{ learnMore( 'docsCustomDomains' ) }
						</>
					) }
					{ data.useCustomDomain && (
						<>
							{ textRow( 'customDomain', __( 'Domain' ) ) }
							{ toggleRow(
								'enableHttps',
								__( 'Enable HTTPS' ),
								<>
									{ __(
										'Test features that require HTTPS and catch issues before your site goes live.'
									) }
									{ learnMore( 'docsSslInStudio' ) } <CertificateTrustNotice />
								</>
							) }
						</>
					) }
				</SettingsGroup>
				<SettingsGroup
					title={ __( 'WordPress credentials' ) }
					description={
						<>
							{ __( 'Sign-in details for this site and its previews.' ) }
							{ learnMore( 'docsSiteSettings' ) }
						</>
					}
				>
					{ textRow(
						'adminUsername',
						__( 'Username' ),
						__( 'The username used to log in to WordPress Admin.' ),
						{ action: copyButton( 'adminUsername', __( 'Copy admin username' ) ) }
					) }
					{ textRow(
						'adminPassword',
						__( 'Password' ),
						__( 'The password used to log in to WordPress Admin.' ),
						{
							type: isPasswordVisible ? 'text' : 'password',
							endAdornment: (
								<IconButton
									variant="muted-ghost"
									size="icon-xs"
									icon={ isPasswordVisible ? <EyeOffIcon /> : <EyeIcon /> }
									label={ isPasswordVisible ? __( 'Hide password' ) : __( 'Show password' ) }
									aria-pressed={ isPasswordVisible }
									onClick={ () => setIsPasswordVisible( ( visible ) => ! visible ) }
								/>
							),
							action: copyButton( 'adminPassword', __( 'Copy admin password' ) ),
						}
					) }
					{ textRow(
						'adminEmail',
						__( 'Email' ),
						__( 'The email address used to log in to WordPress Admin.' ),
						{
							type: 'email',
							className: styles.emailInput,
							action: copyButton( 'adminEmail', __( 'Copy admin email' ) ),
						}
					) }
				</SettingsGroup>
			</>
		),
		php: (
			<SettingsGroup>
				{ selectRow(
					'phpVersion',
					__( 'PHP version' ),
					resolvedPhpVersion === data.phpVersion
						? __( 'The PHP version used to run WordPress on this site.' )
						: sprintf(
								/* translators: %s: the supported PHP version that runs instead, like 8.2. */
								__( 'Native PHP will use %s' ),
								resolvedPhpVersion
						  ),
					phpVersionOptions
				) }
				{ selectRow(
					'fileAccess',
					__( 'File access' ),
					<>
						{ __(
							'Choose whether this site can access only its own folder or other files on your computer.'
						) }
						{ learnMore( 'docsFileAccess' ) }
					</>,
					getFileAccessOptions()
				) }
			</SettingsGroup>
		),
		debugging: (
			<>
				<SettingsGroup>
					{ selectRow(
						'environmentType',
						__( 'Environment' ),
						<>
							{ __(
								'Tells WordPress, themes, and plugins whether this site is used for local work, development, staging, or production. They may adjust features such as caching or debugging based on this value.'
							) }
							{ learnMore( 'docsWpEnvironmentType' ) }
						</>,
						getEnvironmentTypeOptions()
					) }
				</SettingsGroup>
				<SettingsGroup title={ __( 'Debugging' ) }>
					{ toggleRow(
						'enableXdebug',
						__( 'Xdebug' ),
						<>
							{ __(
								'Connect a debugger to inspect PHP execution. Only one site can have Xdebug enabled at a time.'
							) }
							{ learnMore( 'docsXdebug' ) }
						</>,
						xdebugConflictSiteName && ! data.enableXdebug
							? {
									error: sprintf(
										/* translators: %s: the name of the site that has Xdebug enabled. */
										__( 'Xdebug is enabled on another site: %s' ),
										xdebugConflictSiteName
									),
									locked: true,
							  }
							: {}
					) }
					{ toggleRow(
						'enableDebugLog',
						__( 'Debug log' ),
						<>
							{ __( 'Write PHP errors to wp-content/debug.log.' ) }
							{ logExists ? (
								<span className={ styles.debugLogAction }>
									<Button variant="outline" size="header" onClick={ handleOpenLog }>
										{ __( 'Open log file' ) }
									</Button>
								</span>
							) : null }
						</>
					) }
					{ toggleRow(
						'enableScriptDebug',
						__( 'Script debugging' ),
						<>
							{ __( 'Load unminified WordPress JavaScript and CSS for easier debugging.' ) }
							{ learnMore( 'docsScriptDebug' ) }
						</>
					) }
					{ toggleRow(
						'enableDebugDisplay',
						__( 'Show errors in browser' ),
						<>
							{ __( 'Display PHP errors, warnings, and notices.' ) }
							{ learnMore( 'docsDebugDisplay' ) }
						</>
					) }
				</SettingsGroup>
			</>
		),
	};

	return (
		<form id={ FORM_ID } onSubmit={ handleSubmit } className={ styles.form }>
			{ isBusy && ! updateSite.isPending ? (
				<p role="status" className={ styles.busy }>
					{ __( 'Wait for the current site operation to finish before changing settings.' ) }
				</p>
			) : null }
			{ sections[ section ] }
			{ submitError && <div className={ styles.submitError }>{ submitError }</div> }
			{ dirty && dialog.actions
				? createPortal(
						<>
							<Button
								variant="outline"
								size="header"
								disabled={ updateSite.isPending }
								onClick={ () => {
									setData( initial );
									dialog.settle();
								} }
							>
								{ __( 'Discard' ) }
							</Button>
							<Button
								type="submit"
								form={ FORM_ID }
								variant={ canSubmit ? 'default' : 'outline' }
								size="header"
								disabled={ ! canSubmit }
								loading={ updateSite.isPending }
								loadingAnnouncement={ __( 'Saving settings' ) }
							>
								{ __( 'Save' ) }
							</Button>
						</>,
						dialog.actions
				  )
				: null }
		</form>
	);
}
