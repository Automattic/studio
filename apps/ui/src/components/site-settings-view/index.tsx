import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import {
	decodePassword,
	encodePassword,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import {
	getSiteFileAccess,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { siteNeedsRestart } from '@studio/common/lib/site-needs-restart';
import {
	getSiteRuntime,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import {
	getClosestSupportedPhpVersion,
	RecommendedPHPVersion,
	SupportedPHPVersions,
} from '@studio/common/types/php-versions';
import { CheckboxControl, Icon } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __, sprintf } from '@wordpress/i18n';
import { cautionFilled, close } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckpointTimeline } from '@/components/checkpoint-timeline';
import { LearnHowLink } from '@/components/learn-more';
import { AgentInstructionsPanel, WordPressSkillsPanel } from '@/components/site-agent-panels';
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
	fileAccessField,
	phpVersionField,
	runtimeField,
	siteNameField,
	wpVersionField,
} from '@/components/site-fields';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { useCertificateTrust, useTrustCertificate } from '@/data/queries/use-certificate-trust';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useSites, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useWordPressVersions } from '@/data/queries/use-wordpress-versions';
import { useSettingsClose } from '@/hooks/use-settings-close';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { DataFormControlProps, Field, Form } from '@wordpress/dataviews';
import type { FormEvent, ReactNode } from 'react';

// "settings" merges the former General + Debugging forms; "agent" merges the
// former Skills + Instructions panels.
type TabId = 'settings' | 'agent' | 'checkpoints';

interface FormData {
	name: string;
	phpVersion: SupportedPHPVersion;
	// Empty string means "auto-update" — we map that back to
	// DEFAULT_WORDPRESS_VERSION when building the updated site payload.
	wpVersion: string;
	runtime: SiteRuntime;
	fileAccess: SiteFileAccess;
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

function resolvePhpVersion( phpVersion: string | undefined ): SupportedPHPVersion {
	if ( phpVersion && SupportedPHPVersions.includes( phpVersion as SupportedPHPVersion ) ) {
		return phpVersion as SupportedPHPVersion;
	}
	return ( phpVersion && getClosestSupportedPhpVersion( phpVersion ) ) || RecommendedPHPVersion;
}

function getEffectiveWpVersion( site: SiteDetails | undefined ): string {
	return site?.isWpAutoUpdating !== false ? '' : DEFAULT_WORDPRESS_VERSION;
}

function initialFormData( site: SiteDetails ): FormData {
	return {
		name: site.name,
		phpVersion: resolvePhpVersion( site.phpVersion ),
		wpVersion: getEffectiveWpVersion( site ),
		runtime: getSiteRuntime( site ),
		fileAccess: getSiteFileAccess( site ),
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

function getRestartChanges( initial: FormData, data: FormData, site: SiteDetails ) {
	const usedCustomDomain = data.useCustomDomain
		? data.customDomain || generateCustomDomainFromSiteName( data.name )
		: undefined;
	const initialCustomDomain = site.customDomain;
	return {
		domainChanged: usedCustomDomain !== initialCustomDomain,
		httpsChanged: ( !! usedCustomDomain && data.enableHttps ) !== ( site.enableHttps ?? false ),
		phpChanged: data.phpVersion !== initial.phpVersion,
		wpChanged: data.wpVersion.trim() !== initial.wpVersion.trim(),
		runtimeChanged: data.runtime !== initial.runtime,
		fileAccessChanged: data.fileAccess !== initial.fileAccess,
		xdebugChanged: data.enableXdebug !== initial.enableXdebug,
		credentialsChanged:
			data.adminUsername !== initial.adminUsername ||
			data.adminPassword !== initial.adminPassword ||
			data.adminEmail !== initial.adminEmail,
		debugLogChanged: data.enableDebugLog !== initial.enableDebugLog,
		debugDisplayChanged: data.enableDebugDisplay !== initial.enableDebugDisplay,
	};
}

function SettingsHeader( { site }: { site: SiteDetails } ) {
	// Site settings is a fullscreen view with no sidebar, so the header sits
	// alone at the top: the site dropdown on the left, the close button on the
	// right. On macOS it drops below the traffic lights that overlay the
	// top-left corner.
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const onClose = useSettingsClose();
	return (
		<div
			className={
				reserveTrafficLightSpace
					? `${ styles.header } ${ styles.headerTrafficLights }`
					: styles.header
			}
		>
			<SiteDropdown site={ site } showSiteIcon showStatus />
			{ onClose ? (
				<IconButton
					className={ styles.closeButton }
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ close }
					label={ __( 'Close settings' ) }
					onClick={ onClose }
				/>
			) : null }
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

function DebuggingActions( {
	site,
	showTrustCertificate,
	onTrustCertificate,
	onOpenDebugLog,
}: {
	site: SiteDetails;
	showTrustCertificate: boolean;
	onTrustCertificate: () => void;
	onOpenDebugLog: () => void;
} ) {
	if ( ! showTrustCertificate && ! site.enableDebugLog ) {
		return null;
	}
	return (
		<div className={ styles.debuggingActions }>
			{ showTrustCertificate && (
				<Button type="button" variant="outline" onClick={ onTrustCertificate }>
					{ __( 'Trust certificate' ) }
				</Button>
			) }
			{ site.enableDebugLog && (
				<Button type="button" variant="outline" onClick={ onOpenDebugLog }>
					{ __( 'Open debug log' ) }
				</Button>
			) }
		</div>
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
	return (
		<div className={ styles.root }>
			<SettingsHeader site={ site } />
			<SiteSettingsForm site={ site } activeTab={ activeTab } onTabChange={ onTabChange } />
		</div>
	);
}

export function SiteSettingsForm( {
	site,
	activeTab,
	onTabChange,
	embedded = false,
	showTabs = true,
}: {
	site: SiteDetails;
	activeTab: TabId;
	onTabChange: ( tab: TabId ) => void;
	embedded?: boolean;
	showTabs?: boolean;
} ) {
	const connector = useConnector();
	const supportsCheckpoints = connector.capabilities?.siteCheckpoints ?? false;
	const allDomains = useExistingCustomDomains();
	const existingDomainNames = useMemo(
		() => allDomains.filter( ( domain ) => domain !== site.customDomain ),
		[ allDomains, site.customDomain ]
	);
	const xdebugEnabledSite = useXdebugEnabledSite();
	const xdebugConflictSiteName =
		xdebugEnabledSite && xdebugEnabledSite.id !== site.id ? xdebugEnabledSite.name : undefined;
	const { data: wpVersions } = useWordPressVersions();
	const { data: isCertificateTrusted } = useCertificateTrust();
	const trustCertificate = useTrustCertificate();

	const updateSite = useUpdateSite();
	const [ submitError, setSubmitError ] = useState< string | null >( null );

	const [ data, setData ] = useState< FormData >( () => initialFormData( site ) );
	useEffect( () => {
		setData( initialFormData( site ) );
		setSubmitError( null );
	}, [ site ] );

	const storedPhpVersion = site.phpVersion;
	const resolvedSitePhpVersion = resolvePhpVersion( storedPhpVersion );
	const phpVersionWarning =
		storedPhpVersion !== undefined && storedPhpVersion !== resolvedSitePhpVersion
			? sprintf(
					/* translators: 1: unsupported PHP version, 2: supported PHP version */
					__( 'PHP %1$s is no longer supported. Saving will update this site to PHP %2$s.' ),
					storedPhpVersion,
					resolvedSitePhpVersion
			  )
			: undefined;

	const fields = useMemo< Field< FormData >[] >(
		() => [
			siteNameField< FormData >(),
			{
				...phpVersionField< FormData >(),
				description: phpVersionWarning,
			},
			wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION, wpVersions ),
			runtimeField< FormData >(),
			fileAccessField< FormData >(),
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
		[ existingDomainNames, phpVersionWarning, wpVersions, xdebugConflictSiteName ]
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
					id: 'runtimeSettings',
					layout: { type: 'row' },
					children: [ 'runtime', 'fileAccess' ],
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
			if ( next.runtime !== prev.runtime && getSiteRuntime( next ) === SITE_RUNTIME_PLAYGROUND ) {
				next.fileAccess = SITE_FILE_ACCESS_SITE_DIRECTORY;
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
	const willRestart = site.running && siteNeedsRestart( getRestartChanges( initial, data, site ) );
	const showUsernameWarning =
		! validateAdminUsername( data.adminUsername ) &&
		data.adminUsername !== ( site.adminUsername ?? 'admin' );
	const showTrustCertificate = Boolean(
		site.customDomain && site.enableHttps && isCertificateTrusted === false
	);

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
			fileAccess:
				getSiteRuntime( data ) === SITE_RUNTIME_PLAYGROUND
					? SITE_FILE_ACCESS_SITE_DIRECTORY
					: data.fileAccess,
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

	// The "Settings" tab shows the general + debugging fields as one form, with
	// the debugging actions (trust cert / open debug log) beneath them.
	const settingsFormBody = (
		<>
			{ phpVersionWarning && (
				<div className={ styles.phpVersionWarning } role="note">
					<Icon icon={ cautionFilled } size={ 18 } />
					<span>{ phpVersionWarning }</span>
				</div>
			) }
			{ showUsernameWarning && (
				<p className={ styles.inlineWarning }>
					{ __( 'Changing the username will create a new admin user.' ) }
				</p>
			) }
			<DataForm< FormData >
				data={ data }
				fields={ fields }
				form={ fullForm }
				onChange={ handleChange }
				validity={ validity }
			/>
			<DebuggingActions
				site={ site }
				showTrustCertificate={ showTrustCertificate }
				onTrustCertificate={ () => void trustCertificate.mutate() }
				onOpenDebugLog={ () => void connector.openSiteDebugLog( site.id ) }
			/>
		</>
	);

	const settingsForm = (
		<form onSubmit={ handleSubmit } className={ styles.form }>
			{ settingsFormBody }
			{ submitError && <div className={ styles.submitError }>{ submitError }</div> }
			<div className={ styles.actions }>
				<Button
					type="submit"
					variant="solid"
					tone="brand"
					disabled={ ! canSubmit }
					loading={ updateSite.isPending }
					loadingAnnouncement={
						willRestart ? __( 'Saving and restarting…' ) : __( 'Saving settings' )
					}
				>
					{ __( 'Save settings' ) }
				</Button>
			</div>
		</form>
	);

	// The "Agent" tab stacks the skills and instructions panels.
	const agentPanels = (
		<div className={ styles.agentPanels }>
			<WordPressSkillsPanel siteId={ site.id } />
			<AgentInstructionsPanel siteId={ site.id } />
		</div>
	);

	// Embedded in the site overview: the overview owns the tab strip, so render
	// only the active tab's content.
	if ( ! showTabs ) {
		if ( activeTab === 'agent' ) {
			return agentPanels;
		}
		if ( activeTab === 'checkpoints' && supportsCheckpoints ) {
			return <CheckpointTimeline siteId={ site.id } />;
		}
		return <div className={ styles.embeddedContentBlock }>{ settingsForm }</div>;
	}

	// Fullscreen site settings: own the tab strip and mount every panel so the
	// WP Tabs component can toggle between them.
	const tabsContent = (
		<div className={ embedded ? styles.embeddedContentBlock : styles.contentBlock }>
			<Tabs.Panel tabId="settings">{ settingsForm }</Tabs.Panel>
			<Tabs.Panel tabId="agent">{ agentPanels }</Tabs.Panel>
			{ supportsCheckpoints ? (
				<Tabs.Panel tabId="checkpoints">
					<CheckpointTimeline siteId={ site.id } />
				</Tabs.Panel>
			) : null }
		</div>
	);
	const scrollContent: ReactNode = embedded ? (
		tabsContent
	) : (
		<div className={ styles.scroll }>{ tabsContent }</div>
	);

	return (
		<Tabs.Root
			selectedTabId={ activeTab }
			onSelect={ ( tabId ) => {
				if ( tabId && isSiteSettingsTab( tabId ) ) {
					onTabChange( tabId );
				}
			} }
		>
			<div className={ embedded ? styles.embeddedTitleBlock : styles.titleBlock }>
				<h1>{ __( 'Site settings' ) }</h1>
			</div>
			<div className={ embedded ? styles.embeddedTabsBar : styles.tabsBar }>
				<div className={ embedded ? styles.embeddedTabsBarInner : styles.tabsBarInner }>
					<Tabs.List>
						<Tabs.Tab tabId="settings">{ __( 'Settings' ) }</Tabs.Tab>
						<Tabs.Tab tabId="agent">{ __( 'Agent' ) }</Tabs.Tab>
						{ supportsCheckpoints ? (
							<Tabs.Tab tabId="checkpoints">{ __( 'Checkpoints' ) }</Tabs.Tab>
						) : null }
					</Tabs.List>
				</div>
			</div>
			{ scrollContent }
		</Tabs.Root>
	);
}

export function isSiteSettingsTab( value: string ): value is TabId {
	return value === 'settings' || value === 'agent' || value === 'checkpoints';
}

export type SiteSettingsTabId = TabId;
