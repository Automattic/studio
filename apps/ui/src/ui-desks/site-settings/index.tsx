import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { arrowLeft } from '@wordpress/icons';
import { clsx } from 'clsx';
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
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useSites, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { DeskHeader } from '@/ui-desks/chrome/header';
import { DeskMenu } from '@/ui-desks/chrome/user-menu';
import { Button, Surface } from '@/ui-desks/components';
import { desksRootRoute } from '../router/root';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { DataFormControlProps, Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

type TabId = 'general' | 'debugging';

interface SiteSettingsSearch {
	tab?: TabId;
}

interface FormData {
	name: string;
	phpVersion: SupportedPHPVersion;
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

function EnableHttpsControl( { data: item, field, onChange }: DataFormControlProps< FormData > ) {
	return (
		<div className={ styles.checkboxControl }>
			<label className={ styles.checkboxLabel }>
				<input
					type="checkbox"
					checked={ item.enableHttps }
					onChange={ ( event ) => onChange( { enableHttps: event.target.checked } ) }
				/>
				<span>{ field.label }</span>
			</label>
			<p className={ styles.fieldHelp }>
				{ __(
					'You need to manually add the Studio root certificate authority to your keychain and trust it to enable HTTPS.'
				) }{ ' ' }
				<LearnHowLink docsLinksKey="docsSslInStudio" />
			</p>
		</div>
	);
}

function DesksSiteSettingsPage() {
	const { siteId } = desksSiteSettingsRoute.useParams();
	const { tab } = desksSiteSettingsRoute.useSearch();
	const navigate = useNavigate();
	const activeTab: TabId = tab ?? 'general';

	return (
		<DesksSiteSettingsView
			siteId={ siteId }
			activeTab={ activeTab }
			onBack={ () => void navigate( { to: '/sites/$siteId', params: { siteId } } ) }
			onTabChange={ ( next ) =>
				void navigate( {
					to: '/sites/$siteId/settings',
					params: { siteId },
					search: { tab: next },
					replace: true,
				} )
			}
		/>
	);
}

function DesksSiteSettingsView( {
	siteId,
	activeTab,
	onBack,
	onTabChange,
}: {
	siteId: string;
	activeTab: TabId;
	onBack: () => void;
	onTabChange: ( tab: TabId ) => void;
} ) {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );

	return (
		<div className={ styles.root }>
			<DeskHeader
				rightChildren={
					<Button
						type="button"
						icon={ arrowLeft }
						label={ __( 'Back to site desk' ) }
						variant="chrome"
						size="medium"
						onClick={ onBack }
					>
						{ __( 'Site desk' ) }
					</Button>
				}
			>
				<DeskMenu siteId={ siteId } />
			</DeskHeader>
			<main className={ styles.main } aria-label={ __( 'Site settings' ) }>
				{ sitesLoading ? (
					<div className={ styles.state }>{ __( 'Loading...' ) }</div>
				) : site ? (
					<SiteSettingsBody site={ site } activeTab={ activeTab } onTabChange={ onTabChange } />
				) : (
					<div className={ styles.state }>
						<h1>{ __( 'Site not found' ) }</h1>
						<p>{ siteId }</p>
					</div>
				) }
			</main>
		</div>
	);
}

function SiteSettingsTabs( {
	activeTab,
	onTabChange,
}: {
	activeTab: TabId;
	onTabChange: ( tab: TabId ) => void;
} ) {
	return (
		<div className={ styles.tabs } role="tablist" aria-label={ __( 'Site settings sections' ) }>
			{ ( [ 'general', 'debugging' ] as const ).map( ( tabId ) => (
				<button
					key={ tabId }
					type="button"
					role="tab"
					id={ `desks-site-settings-tab-${ tabId }` }
					aria-controls={ `desks-site-settings-panel-${ tabId }` }
					aria-selected={ activeTab === tabId }
					className={ clsx( styles.tab, activeTab === tabId && styles.activeTab ) }
					onClick={ () => onTabChange( tabId ) }
				>
					{ tabId === 'general' ? __( 'General' ) : __( 'Debugging' ) }
				</button>
			) ) }
		</div>
	);
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
	const { data: allDomains } = useExistingCustomDomains();
	const existingDomainNames = useMemo(
		() => ( allDomains ?? [] ).filter( ( domain ) => domain !== site.customDomain ),
		[ allDomains, site.customDomain ]
	);
	const { data: xdebugEnabledSite } = useXdebugEnabledSite();
	const xdebugConflictSiteName =
		xdebugEnabledSite && xdebugEnabledSite.id !== site.id ? xdebugEnabledSite.name : undefined;

	const updateSite = useUpdateSite();
	const [ submitError, setSubmitError ] = useState< string | null >( null );
	const [ data, setData ] = useState< FormData >( () => initialFormData( site ) );

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
					layout: { type: 'row' },
					children: [ 'phpVersion', 'wpVersion' ],
				},
				{
					id: 'adminCredentials',
					layout: { type: 'row' },
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
		<Surface className={ styles.panel }>
			<div className={ styles.panelHeader }>
				<div className={ styles.titleBlock }>
					<p className={ styles.eyebrow }>{ site.name }</p>
					<h1 id="desks-site-settings-title">{ __( 'Site settings' ) }</h1>
				</div>
				<SiteSettingsTabs activeTab={ activeTab } onTabChange={ onTabChange } />
			</div>
			<form onSubmit={ handleSubmit } className={ styles.form }>
				<div
					role="tabpanel"
					id="desks-site-settings-panel-general"
					aria-labelledby="desks-site-settings-tab-general"
					hidden={ activeTab !== 'general' }
				>
					<DataForm< FormData >
						data={ data }
						fields={ fields }
						form={ generalForm }
						onChange={ handleChange }
						validity={ validity }
					/>
				</div>
				<div
					role="tabpanel"
					id="desks-site-settings-panel-debugging"
					aria-labelledby="desks-site-settings-tab-debugging"
					hidden={ activeTab !== 'debugging' }
				>
					<DataForm< FormData >
						data={ data }
						fields={ fields }
						form={ debuggingForm }
						onChange={ handleChange }
						validity={ validity }
					/>
				</div>

				{ submitError && <div className={ styles.submitError }>{ submitError }</div> }

				<div className={ styles.actions }>
					<Button
						type="submit"
						label={ __( 'Save settings' ) }
						variant="filled"
						tone="primary"
						size="medium"
						disabled={ ! canSubmit }
						aria-busy={ updateSite.isPending }
					>
						{ updateSite.isPending ? __( 'Saving...' ) : __( 'Save settings' ) }
					</Button>
				</div>
			</form>
		</Surface>
	);
}

export function isDesksSiteSettingsTab( value: string ): value is TabId {
	return value === 'general' || value === 'debugging';
}

export function validateDesksSiteSettingsSearch(
	search: Record< string, unknown >
): SiteSettingsSearch {
	const value = search.tab;
	if ( typeof value === 'string' && isDesksSiteSettingsTab( value ) ) {
		return { tab: value };
	}
	return {};
}

export const desksSiteSettingsRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/sites/$siteId/settings',
	validateSearch: validateDesksSiteSettingsSearch,
	component: DesksSiteSettingsPage,
} );

export type DesksSiteSettingsTabId = TabId;
