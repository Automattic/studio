import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { CheckboxControl } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgenticSigninBanner } from '@/components/agentic-signin-banner';
import { LearnHowLink } from '@/components/learn-more';
import { SiteDropdown } from '@/components/site-dropdown';
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
import { useSites, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { DataFormControlProps, Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

type TabId = 'overview' | 'general' | 'debugging';

interface FormData {
	name: string;
	phpVersion: SupportedPHPVersion;
	// Empty string means "auto-update" — we map that back to
	// DEFAULT_WORDPRESS_VERSION when building the updated site payload.
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

function getEffectiveWpVersion( site: SiteDetails | undefined ): string {
	// Mirrors the legacy apps/studio behavior: sites created before the auto-
	// updating flag existed fall through to the default too.
	return site?.isWpAutoUpdating !== false ? '' : DEFAULT_WORDPRESS_VERSION;
}

function initialFormData( site: SiteDetails ): FormData {
	return {
		name: site.name,
		phpVersion: ( site.phpVersion as SupportedPHPVersion ) ?? RecommendedPHPVersion,
		wpVersion: getEffectiveWpVersion( site ),
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

function SettingsHeader( { site }: { site: SiteDetails } ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const toggleSpacerClass = sidebarCollapsed
		? reserveTrafficLightSpace
			? styles.toggleSpacer
			: styles.toggleSpacerFlush
		: null;
	return (
		<div className={ styles.header }>
			{ toggleSpacerClass ? <span className={ toggleSpacerClass } aria-hidden="true" /> : null }
			<SiteDropdown site={ site } showSiteIcon showStatus={ sidebarCollapsed } />
		</div>
	);
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

export function SiteSettingsView( {
	siteId,
	activeTab,
	onTabChange,
}: {
	siteId: string;
	activeTab: TabId;
	onTabChange: ( tab: TabId ) => void;
} ) {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );

	if ( sitesLoading ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	if ( ! site ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Site not found' ) }</h1>
				<p>{ siteId }</p>
			</div>
		);
	}

	return <SiteSettingsBody site={ site } activeTab={ activeTab } onTabChange={ onTabChange } />;
}

function SiteSettingsBody( {
	site,
	activeTab,
	onTabChange,
}: {
	site: SiteDetails;
	activeTab: TabId;
	onTabChange: ( tab: TabId ) => void;
} ) {
	const allDomains = useExistingCustomDomains();
	const existingDomainNames = useMemo(
		() => allDomains.filter( ( domain ) => domain !== site.customDomain ),
		[ allDomains, site.customDomain ]
	);
	const xdebugEnabledSite = useXdebugEnabledSite();
	const xdebugConflictSiteName =
		xdebugEnabledSite && xdebugEnabledSite.id !== site.id ? xdebugEnabledSite.name : undefined;

	const updateSite = useUpdateSite();
	const [ submitError, setSubmitError ] = useState< string | null >( null );

	const [ data, setData ] = useState< FormData >( () => initialFormData( site ) );
	// Re-seed the form when the underlying site changes — e.g. after a save,
	// or after another window edits it. React Query returns a new `site`
	// reference on every refetch, so object identity is enough.
	useEffect( () => {
		setData( initialFormData( site ) );
		setSubmitError( null );
	}, [ site ] );

	const fields = useMemo< Field< FormData >[] >(
		() => [
			siteNameField< FormData >(),
			phpVersionField< FormData >(),
			wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION ),
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
		[ existingDomainNames, xdebugConflictSiteName ]
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

	const initial = useMemo( () => initialFormData( site ), [ site ] );
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
		updateSite.mutate(
			{ site: updated, wpVersion: wpPinned || undefined },
			{
				onError: ( error ) => {
					setSubmitError( ( error as Error ).message ?? __( 'Unable to save changes.' ) );
				},
			}
		);
	};

	return (
		<div className={ styles.root }>
			<SettingsHeader site={ site } />
			<Tabs.Root
				selectedTabId={ activeTab }
				onSelect={ ( tabId ) => {
					if ( tabId && isSiteSettingsTab( tabId ) ) {
						onTabChange( tabId );
					}
				} }
			>
				{ /* Title + tabs sit outside the scroll container so the tablist's
					 border-bottom spans the full main-area width. Only the form
					 content scrolls — tabs stay pinned. */ }
				<div className={ styles.titleBlock }>
					<h1>{ __( 'Site settings' ) }</h1>
				</div>
				<div className={ styles.tabsBar }>
					<div className={ styles.tabsBarInner }>
						<Tabs.List>
							<Tabs.Tab tabId="overview">{ __( 'Overview' ) }</Tabs.Tab>
							<Tabs.Tab tabId="general">{ __( 'General' ) }</Tabs.Tab>
							<Tabs.Tab tabId="debugging">{ __( 'Debugging' ) }</Tabs.Tab>
						</Tabs.List>
					</div>
				</div>

				<div className={ styles.scroll }>
					<div className={ styles.contentBlock }>
						<Tabs.Panel tabId="overview">
							<AgenticSigninBanner />
						</Tabs.Panel>
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
					</div>
				</div>
			</Tabs.Root>
		</div>
	);
}

export function isSiteSettingsTab( value: string ): value is TabId {
	return value === 'overview' || value === 'general' || value === 'debugging';
}

export type SiteSettingsTabId = TabId;
