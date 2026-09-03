import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import {
	getSiteFileAccess,
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { BaseControl, CheckboxControl, RadioControl, SelectControl } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { info } from '@wordpress/icons';
import { Button, Notice, Tooltip } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LearnHowLink } from '@/components/learn-more';
import {
	adminEmailField,
	adminPasswordField,
	adminUsernameField,
	customDomainField,
	customDomainToggleField,
	enableDebugDisplayField,
	enableDebugLogField,
	enableXdebugField,
	phpVersionField,
	siteNameField,
	wpVersionField,
} from '@/components/site-fields';
import * as Tabs from '@/components/tabs';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
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
import type { SiteDetails } from '@/data/core';
import type { TracksPanel } from '@studio/common/lib/record-tracks-event';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { DataFormControlProps, Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

type TabId = 'overview' | 'general' | 'debugging';

interface FormData {
	name: string;
	phpVersion: SupportedPHPVersion;
	runtime: SiteRuntime;
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
		runtime: getSiteRuntime( site ),
		fileAccess: getSiteFileAccess( site ),
		wpVersion: getEffectiveWpVersion( site, installedWpVersion ),
		useCustomDomain: Boolean( site.customDomain ),
		customDomain: site.customDomain ?? '',
		enableHttps: site.enableHttps ?? false,
		adminUsername: site.adminUsername ?? 'admin',
		adminPassword: decodePassword( site.adminPassword ?? '' ) || 'password',
		adminEmail: site.adminEmail || 'admin@localhost.com',
		enableXdebug: site.enableXdebug ?? false,
		enableDebugLog: site.enableDebugLog ?? false,
		enableDebugDisplay: site.enableDebugDisplay ?? false,
	};
}

function EnableHttpsControl( { data: item, field, onChange }: DataFormControlProps< FormData > ) {
	return (
		<CheckboxControl
			__nextHasNoMarginBottom
			label={ field.label }
			checked={ item.enableHttps }
			onChange={ ( checked ) => onChange( { enableHttps: checked } ) }
			help={
				<>
					{ __(
						'You need to manually add the Studio root certificate authority to your keychain and trust it to enable HTTPS.'
					) }{ ' ' }
					<LearnHowLink docsLinksKey="docsSslInStudio" />
				</>
			}
		/>
	);
}

function PhpVersionControl( {
	data: item,
	field,
	onChange,
	hideLabelFromVision,
}: DataFormControlProps< FormData > ) {
	const value = field.getValue( { item } ) ?? '';
	return (
		<SelectControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			className={ styles.phpVersionControl }
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			value={ value }
			disabled={ field.isDisabled( { item, field } ) }
			onChange={ ( nextValue ) => onChange( field.setValue( { item, value: nextValue } ) ) }
		>
			{ field.elements?.map( ( option ) => (
				<option key={ option.value } value={ option.value }>
					{ option.label }
				</option>
			) ) }
		</SelectControl>
	);
}

function PhpRuntimeControl( {
	data: item,
	field,
	onChange,
	hideLabelFromVision,
}: DataFormControlProps< FormData > ) {
	return (
		<RadioControl
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			selected={ item.runtime }
			disabled={ field.isDisabled( { item, field } ) }
			options={ [
				{
					label: __( 'Native' ),
					value: SITE_RUNTIME_NATIVE_PHP,
					description: __( 'Runs the site with native PHP for the best performance.' ),
				},
				{
					label: __( 'Sandbox' ),
					value: SITE_RUNTIME_PLAYGROUND,
					description: __( 'Runs the site in an isolated WordPress Playground sandbox.' ),
				},
			] }
			onChange={ ( runtime ) => onChange( { runtime: runtime as SiteRuntime } ) }
		/>
	);
}

function FileAccessControl( {
	data: item,
	field,
	onChange,
	hideLabelFromVision,
}: DataFormControlProps< FormData > ) {
	const sandboxed = item.runtime === SITE_RUNTIME_PLAYGROUND;
	const options = (
		<RadioControl
			label={ field.label }
			hideLabelFromVision
			selected={ item.fileAccess }
			disabled={ field.isDisabled( { item, field } ) }
			options={ [
				{
					label: __( 'Site directory' ),
					value: SITE_FILE_ACCESS_SITE_DIRECTORY,
					description: __( "Restricts PHP's file access to this site's directory." ),
				},
				{
					label: __( 'All files' ),
					value: SITE_FILE_ACCESS_ALL_FILES,
					description: __( 'PHP can access any file on your system.' ),
				},
			] }
			onChange={ ( fileAccess ) => onChange( { fileAccess: fileAccess as SiteFileAccess } ) }
		/>
	);
	return (
		<div className={ styles.fileAccessControl }>
			{ ! hideLabelFromVision && (
				<BaseControl.VisualLabel>{ field.label }</BaseControl.VisualLabel>
			) }
			{ sandboxed && (
				<Notice.Root className={ styles.fileAccessNotice } icon={ info }>
					<Notice.Description>
						{ __( 'The sandbox can only access the site directory.' ) }
					</Notice.Description>
				</Notice.Root>
			) }
			{ sandboxed ? (
				<Tooltip.Root>
					<Tooltip.Trigger
						render={ <div className={ styles.disabledFileAccess } tabIndex={ 0 } /> }
					>
						{ options }
					</Tooltip.Trigger>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" align="start" /> }>
						{ __( 'Requires the Native PHP runtime' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
			) : (
				options
			) }
		</div>
	);
}

/**
 * The site settings form (General + Debugging), rendered as tab panels inside
 * a `Tabs.Root` owned by the caller — the site overview view. One instance
 * spans both panels so unsaved edits survive tab switches.
 */
export function SiteSettingsForm( {
	site,
	activeTab,
	footerActionsElement,
}: {
	site: SiteDetails;
	activeTab: TabId;
	footerActionsElement: HTMLElement | null;
} ) {
	const formId = `site-settings-${ site.id }`;
	const allDomains = useExistingCustomDomains();
	const existingDomainNames = useMemo(
		() => allDomains.filter( ( domain ) => domain !== site.customDomain ),
		[ allDomains, site.customDomain ]
	);
	const xdebugEnabledSite = useXdebugEnabledSite();
	const xdebugConflictSiteName =
		xdebugEnabledSite && xdebugEnabledSite.id !== site.id ? xdebugEnabledSite.name : undefined;

	const updateSite = useUpdateSite();
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
			{ ...phpVersionField< FormData >(), Edit: PhpVersionControl },
			{
				id: 'runtime',
				type: 'text',
				label: __( 'PHP runtime' ),
				Edit: PhpRuntimeControl,
			},
			{
				id: 'fileAccess',
				type: 'text',
				label: __( 'File access' ),
				isDisabled: data.runtime === SITE_RUNTIME_PLAYGROUND,
				Edit: FileAccessControl,
			},
			wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION, wpVersions, {
				latestValue: '',
				currentVersion:
					installedWpVersion && installedWpVersion !== '-' ? installedWpVersion : undefined,
				offline: isOffline,
			} ),
			{
				...adminUsernameField< FormData >(),
				label: __( 'Username' ),
				Edit: AdminUsernameControl,
			},
			{
				...adminPasswordField< FormData >(),
				label: __( 'Password' ),
				Edit: AdminPasswordControl,
			},
			{ ...adminEmailField< FormData >(), label: __( 'Email' ), Edit: AdminEmailControl },
			customDomainToggleField< FormData >(),
			customDomainField< FormData >( existingDomainNames ),
			{
				id: 'enableHttps',
				type: 'boolean',
				label: __( 'Enable HTTPS' ),
				isVisible: ( item: FormData ) => item.useCustomDomain,
				Edit: EnableHttpsControl,
			},
			enableXdebugField< FormData >( { conflictingSiteName: xdebugConflictSiteName } ),
			enableDebugLogField< FormData >(),
			enableDebugDisplayField< FormData >(),
		],
		[
			data.runtime,
			existingDomainNames,
			installedWpVersion,
			isOffline,
			wpVersions,
			xdebugConflictSiteName,
		]
	);

	const generalForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [
				{
					id: 'siteDetails',
					label: __( 'Site details' ),
					layout: { type: 'regular', labelPosition: 'top' },
					children: [ 'name', 'wpVersion' ],
				},
				{
					id: 'phpEnvironment',
					label: __( 'PHP environment' ),
					layout: { type: 'regular', labelPosition: 'top' },
					children: [ 'phpVersion', 'runtime', 'fileAccess' ],
				},
				{
					id: 'administrator',
					label: __( 'Administrator' ),
					layout: { type: 'regular', labelPosition: 'top' },
					children: [ 'adminUsername', 'adminPassword', 'adminEmail' ],
				},
				{
					id: 'domain',
					label: __( 'Domain' ),
					layout: { type: 'regular', labelPosition: 'top' },
					children: [ 'useCustomDomain', 'customDomain', 'enableHttps' ],
				},
			],
		} ),
		[]
	);
	const debuggingForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [ 'enableXdebug', 'enableDebugLog', 'enableDebugDisplay' ],
		} ),
		[]
	);
	const fullForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [ ...generalForm.fields!, ...debuggingForm.fields! ],
		} ),
		[ generalForm, debuggingForm ]
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
			if ( next.runtime === SITE_RUNTIME_PLAYGROUND ) {
				next.fileAccess = SITE_FILE_ACCESS_SITE_DIRECTORY;
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
			runtime: data.runtime,
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
		<form id={ formId } onSubmit={ handleSubmit } className={ styles.form }>
			<Tabs.Panel tabId="general">
				<div className={ `${ styles.settingsColumn } ${ styles.generalSections }` }>
					<DataForm< FormData >
						data={ data }
						fields={ fields }
						form={ generalForm }
						onChange={ handleChange }
						validity={ validity }
					/>
				</div>
			</Tabs.Panel>
			<Tabs.Panel tabId="debugging">
				<div className={ styles.settingsColumn }>
					<DataForm< FormData >
						data={ data }
						fields={ fields }
						form={ debuggingForm }
						onChange={ handleChange }
						validity={ validity }
					/>
				</div>
			</Tabs.Panel>

			{ submitError && <div className={ styles.submitError }>{ submitError }</div> }

			{ /* The save action shares the fixed footer with the preview toggle. */ }
			{ footerActionsElement && activeTab !== 'overview'
				? createPortal(
						<Button
							form={ formId }
							type="submit"
							variant="solid"
							tone="brand"
							disabled={ ! canSubmit }
							loading={ updateSite.isPending }
							loadingAnnouncement={ __( 'Saving settings' ) }
						>
							{ __( 'Save settings' ) }
						</Button>,
						footerActionsElement
				  )
				: null }
		</form>
	);
}

export function isSiteSettingsTab( value: string ): value is TabId {
	return value === 'overview' || value === 'general' || value === 'debugging';
}

export type SiteSettingsTabId = TabId;

// The `studio_panel_opened` value for a tab. The General tab reports `settings` so it lines up with
// Studio Classic's Settings panel; overview and debugging keep their own names.
export function siteSettingsTabToPanel( tab: TabId ): TracksPanel {
	return tab === 'general' ? 'settings' : tab;
}
