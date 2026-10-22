import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	decodeAdminPassword,
	encodePassword,
} from '@studio/common/lib/passwords';
import { getSiteFileAccess } from '@studio/common/lib/site-file-access';
import { getWpEnvironmentType } from '@studio/common/lib/wp-environment-type';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsDialog } from '@/components/settings-dialog/context';
import { SettingsGroup, SettingsRow, SettingsToggle } from '@/components/settings-view/rows';
import {
	adminEmailField,
	adminPasswordField,
	adminUsernameField,
	customDomainField,
	customDomainToggleField,
	enableDebugDisplayField,
	enableDebugLogField,
	enableScriptDebugField,
	enableXdebugField,
	environmentTypeField,
	fileAccessField,
	phpVersionField,
	siteNameField,
	wpVersionField,
} from '@/components/site-fields';
import { CertificateTrustNotice } from '@/components/site-fields/enable-https-control';
import { Button } from '@/components/ui/button';
import { useConnector } from '@/data/core';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useDebugLogExists } from '@/data/queries/use-debug-log';
import { useIsSiteBusy, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import {
	AdminEmailControl,
	AdminPasswordControl,
	AdminUsernameControl,
	SiteNameControl,
} from './copyable-credential-control';
import { selectRow, textRow, toggleRow } from './rows';
import styles from './style.module.css';
import type { SiteSettingsSectionId } from '@/components/settings-dialog/context';
import type { SiteDetails } from '@/data/core';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { WpEnvironmentType } from '@studio/common/lib/wp-environment-type';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { DataFormControlProps, Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

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

// Outside the fields memo, which rebuilds as WordPress versions load: a new row
// component there would remount the input and drop the focus Rename gives it.
function SiteNameRow( props: DataFormControlProps< FormData > ) {
	return (
		<SettingsRow title={ __( 'Site name' ) } description={ __( 'Name shown in Studio.' ) }>
			<SiteNameControl
				{ ...props }
				hideLabelFromVision
				field={ { ...props.field, description: undefined } }
			/>
		</SettingsRow>
	);
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
const FORM_LAYOUT = { type: 'regular', labelPosition: 'none' } as const;
const SECTION_GROUPS: Record< SiteSettingsSectionId, string[][] > = {
	site: [
		[ 'name', 'wpVersion' ],
		[ 'useCustomDomain', 'customDomain', 'enableHttps' ],
		[ 'adminUsername', 'adminPassword', 'adminEmail' ],
	],
	php: [ [ 'phpVersion', 'fileAccess' ] ],
	debugging: [
		[ 'environmentType' ],
		[ 'enableXdebug', 'enableDebugLog', 'enableScriptDebug', 'enableDebugDisplay' ],
	],
};
const FULL_FORM: Form = { layout: FORM_LAYOUT, fields: Object.values( SECTION_GROUPS ).flat( 2 ) };

/**
 * The site settings form, one section at a time. One instance spans every
 * section so unsaved edits survive switching between them; its Discard and
 * Save buttons sit in the settings dialog's header.
 */
export function SiteSettingsForm( {
	site,
	section,
	active,
}: {
	site: SiteDetails;
	section: SiteSettingsSectionId;
	active: boolean;
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

	const fields = useMemo< Field< FormData >[] >( () => {
		const currentWpVersion =
			installedWpVersion && installedWpVersion !== '-' ? installedWpVersion : undefined;
		const wpVersion = wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION, wpVersions, {
			latestValue: '',
			currentVersion: currentWpVersion,
			// Current selection, not `site.isWpAutoUpdating`: the persisted flag
			// lags a save by a site-updated event, which would drop the version
			// from the label right after switching to auto-update.
			autoUpdateVersion: data.wpVersion === '' ? installedWpVersion : undefined,
			offline: isOffline,
		} );
		const VersionRow = selectRow< FormData >(
			__( 'WordPress version' ),
			__( 'Choose the WordPress release for this site.' )
		);
		return [
			{ ...siteNameField< FormData >(), Edit: SiteNameRow },
			{
				...wpVersion,
				Edit: ( props: DataFormControlProps< FormData > ) => (
					<>
						<VersionRow { ...props } />
						<SettingsRow
							title={ __( 'Automatic updates' ) }
							description={ __( 'Keep WordPress updated to the latest released version.' ) }
						>
							<SettingsToggle
								label={ __( 'Automatic updates' ) }
								checked={ props.data.wpVersion === '' }
								disabled={ isOffline }
								onChange={ ( automatic ) =>
									props.onChange( {
										wpVersion: automatic ? '' : currentWpVersion ?? DEFAULT_WORDPRESS_VERSION,
									} )
								}
							/>
						</SettingsRow>
					</>
				),
			},
			{
				...customDomainToggleField< FormData >(),
				Edit: toggleRow< FormData >(
					__( 'Use custom domain' ),
					__( 'Use a local address like my-site.local.' )
				),
			},
			{
				...customDomainField< FormData >( existingDomainNames ),
				Edit: textRow< FormData >( SiteNameControl, __( 'Domain' ) ),
			},
			{
				id: 'enableHttps',
				type: 'boolean',
				label: __( 'Enable HTTPS' ),
				isVisible: ( item: FormData ) => item.useCustomDomain,
				Edit: toggleRow< FormData >(
					__( 'Enable HTTPS' ),
					<>
						{ __( 'Use a secure local connection with an SSL certificate.' ) }{ ' ' }
						<CertificateTrustNotice />
					</>
				),
			},
			{
				...adminUsernameField< FormData >(),
				Edit: textRow< FormData >(
					AdminUsernameControl,
					__( 'Username' ),
					__( 'The username used to log in to WordPress Admin.' )
				),
			},
			{
				...adminPasswordField< FormData >(),
				Edit: textRow< FormData >(
					AdminPasswordControl,
					__( 'Password' ),
					__( 'The password used to log in to WordPress Admin.' )
				),
			},
			{
				...adminEmailField< FormData >(),
				Edit: textRow< FormData >(
					AdminEmailControl,
					__( 'Email' ),
					__( 'The email address used to log in to WordPress Admin.' )
				),
			},
			{
				...phpVersionField< FormData >(),
				Edit: selectRow< FormData >(
					__( 'PHP version' ),
					__( 'The PHP version used to run WordPress on this site.' )
				),
			},
			{
				...fileAccessField< FormData >(),
				Edit: selectRow< FormData >(
					__( 'File access' ),
					__(
						'Choose whether this site can access only its own folder or other files on your computer.'
					)
				),
			},
			{ ...environmentTypeField< FormData >(), Edit: selectRow< FormData >( __( 'Environment' ) ) },
			{
				...enableXdebugField< FormData >( { conflictingSiteName: xdebugConflictSiteName } ),
				Edit: toggleRow< FormData >(
					__( 'Xdebug' ),
					xdebugConflictSiteName
						? undefined
						: __(
								'Connect a debugger to inspect PHP execution. Only one site can have Xdebug enabled at a time.'
						  )
				),
			},
			{
				...enableDebugLogField< FormData >(),
				Edit: toggleRow< FormData >(
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
				),
			},
			{
				...enableScriptDebugField< FormData >(),
				Edit: toggleRow< FormData >(
					__( 'Script debugging' ),
					__( 'Load unminified WordPress JavaScript and CSS for easier debugging.' )
				),
			},
			{
				...enableDebugDisplayField< FormData >(),
				Edit: toggleRow< FormData >(
					__( 'Show errors in browser' ),
					__( 'Display PHP errors, warnings, and notices.' )
				),
			},
		];
	}, [
		data.wpVersion,
		existingDomainNames,
		handleOpenLog,
		installedWpVersion,
		isOffline,
		logExists,
		wpVersions,
		xdebugConflictSiteName,
	] );

	// Headings for the groups that have one, by their first field.
	const headings: Record< string, { title: string; description?: string } > = {
		useCustomDomain: { title: __( 'Local domain' ) },
		adminUsername: {
			title: __( 'WordPress credentials' ),
			description: __( 'Sign-in details for this site and its previews.' ),
		},
		enableXdebug: { title: __( 'Debugging' ) },
	};

	const { validity, isValid } = useFormValidity( data, fields, FULL_FORM );

	const handleChange = useCallback( ( update: Record< string, unknown > ) => {
		setData( ( prev ) => {
			const next: FormData = { ...prev, ...( update as Partial< FormData > ) };
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

	const xdebugBlocked = data.enableXdebug && !! xdebugConflictSiteName && ! site.enableXdebug;
	// Saving restarts the server to apply a PHP/WordPress/domain change, so the
	// CLI refuses it while anything else holds the site.
	const isBusy = useIsSiteBusy( site );
	const canSubmit =
		isValid && ! isUnchanged && ! updateSite.isPending && ! xdebugBlocked && ! isBusy;

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
				onError: ( error ) => {
					setSubmitError( ( error as Error ).message ?? __( 'Unable to save changes.' ) );
				},
			}
		);
	};

	return (
		<form id={ FORM_ID } onSubmit={ handleSubmit } className={ styles.form }>
			{ SECTION_GROUPS[ section ].map( ( group ) => (
				<SettingsGroup
					key={ group[ 0 ] }
					title={ headings[ group[ 0 ] ]?.title }
					description={ headings[ group[ 0 ] ]?.description }
				>
					<DataForm< FormData >
						data={ data }
						fields={ fields }
						form={ { layout: FORM_LAYOUT, fields: group } }
						onChange={ handleChange }
						validity={ validity }
					/>
				</SettingsGroup>
			) ) }
			{ submitError && <div className={ styles.submitError }>{ submitError }</div> }
			{ active && dirty && dialog.actions
				? createPortal(
						<>
							<Button
								variant="outline"
								size="header"
								disabled={ updateSite.isPending }
								onClick={ () => setData( initial ) }
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
