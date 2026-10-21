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
import { CheckboxControl } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsDialog } from '@/components/settings-dialog/context';
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
import { EnableHttpsControl } from '@/components/site-fields/enable-https-control';
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

/**
 * The debug log checkbox, plus a shortcut to the log once one exists. A custom
 * `Edit` replaces DataForm's rendering, so the description is re-emitted here.
 */
function EnableDebugLogControl( {
	data: item,
	field,
	onChange,
	logExists,
	onOpenLog,
}: DataFormControlProps< FormData > & { logExists: boolean; onOpenLog: () => void } ) {
	return (
		<CheckboxControl
			__nextHasNoMarginBottom
			label={ field.label }
			checked={ item.enableDebugLog }
			onChange={ ( checked ) => onChange( { enableDebugLog: checked } ) }
			help={
				<>
					{ field.description }
					{ /* A span, not a div: `help` renders inside a paragraph. */ }
					{ logExists && (
						<span className={ styles.debugLogAction }>
							<Button
								type="button"
								variant="outline"
								tone="neutral"
								size="compact"
								onClick={ onOpenLog }
							>
								{ __( 'Open log file' ) }
							</Button>
						</span>
					) }
				</>
			}
		/>
	);
}

const FORM_ID = 'site-settings-form';

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

	const fields = useMemo< Field< FormData >[] >(
		() => [
			{ ...siteNameField< FormData >(), Edit: SiteNameControl },
			phpVersionField< FormData >(),
			fileAccessField< FormData >(),
			wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION, wpVersions, {
				latestValue: '',
				currentVersion:
					installedWpVersion && installedWpVersion !== '-' ? installedWpVersion : undefined,
				// Current selection, not `site.isWpAutoUpdating`: the persisted flag
				// lags a save by a site-updated event, which would drop the version
				// from the label right after switching to auto-update.
				autoUpdateVersion: data.wpVersion === '' ? installedWpVersion : undefined,
				offline: isOffline,
			} ),
			{ ...adminUsernameField< FormData >(), Edit: AdminUsernameControl },
			{ ...adminPasswordField< FormData >(), Edit: AdminPasswordControl },
			{ ...adminEmailField< FormData >(), Edit: AdminEmailControl },
			customDomainToggleField< FormData >(),
			customDomainField< FormData >( existingDomainNames ),
			{
				id: 'enableHttps',
				type: 'boolean',
				label: __( 'Enable HTTPS' ),
				isVisible: ( item: FormData ) => item.useCustomDomain,
				Edit: EnableHttpsControl< FormData >,
			},
			enableXdebugField< FormData >( { conflictingSiteName: xdebugConflictSiteName } ),
			{
				...enableDebugLogField< FormData >(),
				Edit: ( props: DataFormControlProps< FormData > ) => (
					<EnableDebugLogControl
						{ ...props }
						logExists={ !! logExists }
						onOpenLog={ handleOpenLog }
					/>
				),
			},
			enableDebugDisplayField< FormData >(),
			enableScriptDebugField< FormData >(),
			environmentTypeField< FormData >(),
		],
		[
			data.wpVersion,
			existingDomainNames,
			handleOpenLog,
			installedWpVersion,
			isOffline,
			logExists,
			wpVersions,
			xdebugConflictSiteName,
		]
	);

	const forms = useMemo< Record< SiteSettingsSectionId, Form > >( () => {
		const card = ( id: string, label: string, children: string[] ) => ( {
			id,
			label,
			layout: { type: 'card', withHeader: true, isCollapsible: false } as const,
			children,
		} );
		const layout = { type: 'regular' as const, labelPosition: 'top' as const };
		return {
			site: {
				layout,
				fields: [
					card( 'siteDetails', __( 'Site details' ), [ 'name', 'wpVersion' ] ),
					card( 'wordpressAdmin', __( 'WordPress admin' ), [
						'adminUsername',
						'adminPassword',
						'adminEmail',
					] ),
					card( 'domain', __( 'Domain' ), [ 'useCustomDomain', 'customDomain', 'enableHttps' ] ),
				],
			},
			php: {
				layout,
				fields: [
					card( 'phpEnvironment', __( 'PHP environment' ), [ 'phpVersion', 'fileAccess' ] ),
				],
			},
			debugging: {
				layout,
				fields: [
					card( 'debugging', __( 'Debugging' ), [
						'enableXdebug',
						'enableDebugLog',
						'enableDebugDisplay',
						'enableScriptDebug',
						'environmentType',
					] ),
				],
			},
		};
	}, [] );
	const fullForm = useMemo< Form >(
		() => ( {
			layout: forms.site.layout,
			fields: [ ...forms.site.fields!, ...forms.php.fields!, ...forms.debugging.fields! ],
		} ),
		[ forms ]
	);

	const { validity, isValid } = useFormValidity( data, fields, fullForm );

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
			<DataForm< FormData >
				data={ data }
				fields={ fields }
				form={ forms[ section ] }
				onChange={ handleChange }
				validity={ validity }
			/>
			{ submitError && <div className={ styles.submitError }>{ submitError }</div> }
			{ active && dirty && dialog.actions
				? createPortal(
						<>
							<Button
								variant="outline"
								tone="neutral"
								size="compact"
								disabled={ updateSite.isPending }
								onClick={ () => setData( initial ) }
							>
								{ __( 'Discard' ) }
							</Button>
							<Button
								type="submit"
								form={ FORM_ID }
								variant="solid"
								tone="neutral"
								size="compact"
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
