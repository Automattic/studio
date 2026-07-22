import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { CheckboxControl } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { DataFormControlProps, Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

type TabId = 'overview' | 'general' | 'debugging';

interface FormData {
	name: string;
	phpVersion: SupportedPHPVersion;
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

/**
 * The site settings form (General + Debugging), rendered as tab panels inside
 * a `Tabs.Root` owned by the caller — the site overview view. One instance
 * spans both panels so unsaved edits survive tab switches.
 */
export function SiteSettingsForm( { site, activeTab }: { site: SiteDetails; activeTab: TabId } ) {
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
	// refetch, so object identity is enough. While offline, "latest" is the
	// only version we can apply without a download, so it's forced — same as
	// the legacy version selector.
	//
	// Skipped while a save is in flight: editing a site restarts it, and those
	// restart events refresh `site` before the edit has landed on disk, which
	// would momentarily seed the form with pre-save values.
	const isSaving = updateSite.isPending;
	useEffect( () => {
		if ( isSaving ) {
			return;
		}
		const seeded = initialFormData( site, installedWpVersion );
		setData( isOffline ? { ...seeded, wpVersion: '' } : seeded );
	}, [ site, installedWpVersion, isOffline, isSaving ] );

	// Kept out of the effect above so a failed save's error survives the
	// save finishing; it clears once the site itself changes.
	useEffect( () => {
		setSubmitError( null );
	}, [ site ] );

	const fields = useMemo< Field< FormData >[] >(
		() => [
			siteNameField< FormData >(),
			phpVersionField< FormData >(),
			wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION, wpVersions, {
				latestValue: '',
				currentVersion:
					installedWpVersion && installedWpVersion !== '-' ? installedWpVersion : undefined,
				offline: isOffline,
			} ),
			adminUsernameField< FormData >(),
			adminPasswordField< FormData >(),
			adminEmailField< FormData >(),
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
		[ existingDomainNames, installedWpVersion, isOffline, wpVersions, xdebugConflictSiteName ]
	);

	const generalForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [
				'name',
				{
					id: 'versions',
					layout: { type: 'row', alignment: 'start' },
					children: [ 'phpVersion', 'wpVersion' ],
				},
				{
					id: 'adminCredentials',
					layout: { type: 'row', alignment: 'start' },
					children: [ 'adminUsername', 'adminPassword' ],
				},
				'adminEmail',
				'useCustomDomain',
				'customDomain',
				'enableHttps',
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
	const canSubmit = isValid && ! isUnchanged && ! updateSite.isPending && ! xdebugBlocked;

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
		// trigger a WordPress reinstall.
		updateSite.mutate(
			{
				site: updated,
				wpVersion: wpPinned && data.wpVersion !== initial.wpVersion ? wpPinned : undefined,
			},
			{
				onError: ( error ) => {
					setSubmitError( ( error as Error ).message ?? __( 'Unable to save changes.' ) );
				},
			}
		);
	};

	return (
		<form onSubmit={ handleSubmit } className={ styles.form }>
			<Tabs.Panel tabId="general">
				<DataForm< FormData >
					data={ data }
					fields={ fields }
					form={ generalForm }
					onChange={ handleChange }
					validity={ validity }
				/>
			</Tabs.Panel>
			<Tabs.Panel tabId="debugging">
				<DataForm< FormData >
					data={ data }
					fields={ fields }
					form={ debuggingForm }
					onChange={ handleChange }
					validity={ validity }
				/>
			</Tabs.Panel>

			{ submitError && <div className={ styles.submitError }>{ submitError }</div> }

			{ /* The save actions apply to the form tabs only, not Overview. */ }
			{ activeTab !== 'overview' && (
				<div className={ styles.actions }>
					<Button
						type="submit"
						variant="solid"
						tone="brand"
						disabled={ ! canSubmit }
						loading={ updateSite.isPending }
						loadingAnnouncement={ __( 'Saving settings' ) }
					>
						{ __( 'Save settings' ) }
					</Button>
				</div>
			) }
		</form>
	);
}

export function isSiteSettingsTab( value: string ): value is TabId {
	return value === 'overview' || value === 'general' || value === 'debugging';
}

export type SiteSettingsTabId = TabId;
