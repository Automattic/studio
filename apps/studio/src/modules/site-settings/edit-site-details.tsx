import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import {
	decodePassword,
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import {
	getSiteFileAccess,
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { siteNeedsRestart } from '@studio/common/lib/site-needs-restart';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import {
	getWpEnvironmentType,
	WP_ENVIRONMENT_TYPE_DEVELOPMENT,
	WP_ENVIRONMENT_TYPE_LOCAL,
	WP_ENVIRONMENT_TYPE_PRODUCTION,
	WP_ENVIRONMENT_TYPE_STAGING,
	type WpEnvironmentType,
} from '@studio/common/lib/wp-environment-type';
import {
	getClosestSupportedPhpVersion,
	RecommendedPHPVersion,
	SupportedPHPVersion,
	SupportedPHPVersions,
} from '@studio/common/types/php-versions';
import { Icon, SelectControl, TabPanel } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { cautionFilled } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { ErrorInformation } from 'src/components/error-information';
import { LearnMoreLink, LearnHowLink } from 'src/components/learn-more';
import Modal from 'src/components/modal';
import PasswordControl from 'src/components/password-control';
import { AgentInstructionsPanel, WordPressSkillsPanel } from 'src/components/site-settings-panels';
import TextControlComponent from 'src/components/text-control';
import { Tooltip } from 'src/components/tooltip';
import { WPVersionSelector } from 'src/components/wp-version-selector';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { FileAccessDescription, RuntimeDescription } from 'src/lib/site-runtime-copy';
import { useCheckCertificateTrustQuery } from 'src/stores/certificate-trust-api';

type EditSiteDetailsProps = {
	currentWpVersion: string;
	onSave: () => void;
};

function resolvePhpVersion( phpVersion: string | undefined ): SupportedPHPVersion {
	if ( phpVersion && SupportedPHPVersions.includes( phpVersion as SupportedPHPVersion ) ) {
		return phpVersion as SupportedPHPVersion;
	}
	return ( phpVersion && getClosestSupportedPhpVersion( phpVersion ) ) || RecommendedPHPVersion;
}

const EditSiteDetails = ( { currentWpVersion, onSave }: EditSiteDetailsProps ) => {
	const { __ } = useI18n();
	const {
		updateSite,
		selectedSite,
		isEditModalOpen,
		setIsEditModalOpen,
		editModalInitialTab,
		setEditModalInitialTab,
	} = useSiteDetails();
	const [ errorUpdatingWpVersion, setErrorUpdatingWpVersion ] = useState< string | null >( null );
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const [ needsRestart, setNeedsRestart ] = useState( false );
	const [ enableXdebug, setEnableXdebug ] = useState( selectedSite?.enableXdebug ?? false );
	const [ enableDebugLog, setEnableDebugLog ] = useState( selectedSite?.enableDebugLog ?? false );
	const [ enableDebugDisplay, setEnableDebugDisplay ] = useState(
		selectedSite?.enableDebugDisplay ?? false
	);
	const [ enableScriptDebug, setEnableScriptDebug ] = useState(
		selectedSite?.enableScriptDebug ?? false
	);
	const [ environmentType, setEnvironmentType ] = useState< WpEnvironmentType >(
		getWpEnvironmentType( selectedSite ?? {} )
	);
	const [ xdebugEnabledSite, setXdebugEnabledSite ] = useState< SiteDetails | null >( null );
	const [ adminUsername, setAdminUsername ] = useState( selectedSite?.adminUsername ?? 'admin' );
	const [ adminPassword, setAdminPassword ] = useState(
		() => decodePassword( selectedSite?.adminPassword ?? '' ) || 'password'
	);
	const [ adminEmail, setAdminEmail ] = useState(
		selectedSite?.adminEmail || 'admin@localhost.com'
	);
	const [ selectedRuntime, setSelectedRuntime ] = useState< SiteRuntime >(
		getSiteRuntime( selectedSite ?? {} )
	);
	const [ selectedFileAccess, setSelectedFileAccess ] = useState< SiteFileAccess >(
		getSiteFileAccess( selectedSite ?? {} )
	);
	// The sandbox only has access to the site directory, so "all files" is
	// forced back to "site directory" when the sandbox mode is selected.
	const usedFileAccess =
		selectedRuntime === SITE_RUNTIME_PLAYGROUND
			? SITE_FILE_ACCESS_SITE_DIRECTORY
			: selectedFileAccess;
	const selectedSitePhpVersion = selectedSite?.phpVersion;
	const resolvedSitePhpVersion = resolvePhpVersion( selectedSitePhpVersion );
	const phpVersionWarning =
		selectedSitePhpVersion !== undefined && selectedSitePhpVersion !== resolvedSitePhpVersion
			? sprintf(
					__( 'PHP %1$s is no longer supported. Saving will update this site to PHP %2$s.' ),
					selectedSitePhpVersion,
					resolvedSitePhpVersion
			  )
			: undefined;

	useEffect( () => {
		if ( selectedSite?.adminEmail || ! selectedSite?.id ) {
			return;
		}
		const username = selectedSite?.adminUsername ?? 'admin';
		getIpcApi()
			.executeWPCLiInline( {
				siteId: selectedSite.id,
				args: `user get ${ username } --field=user_email`,
				skipPluginsAndThemes: true,
			} )
			.then( ( { stdout, stderr } ) => {
				if ( ! stderr && stdout.trim() ) {
					setAdminEmail( stdout.trim() );
				}
			} )
			.catch( () => {
				// Keep the default value
			} );
	}, [ selectedSite?.id, selectedSite?.adminEmail, selectedSite?.adminUsername ] );

	const { data: isCertificateTrusted } = useCheckCertificateTrustQuery();
	const closeModal = useCallback( () => {
		if ( isEditingSite ) {
			return;
		}
		setIsEditModalOpen( false );
	}, [ isEditingSite, setIsEditModalOpen ] );
	const [ siteName, setSiteName ] = useState( selectedSite?.name ?? '' );
	const [ selectedPhpVersion, setSelectedPhpVersion ] =
		useState< SupportedPHPVersion >( resolvedSitePhpVersion );
	const getEffectiveWpVersion = useCallback(
		() =>
			// undefined means that this site was created before the isWpAutoUpdating option was introduced to Studio
			[ undefined, true ].includes( selectedSite?.isWpAutoUpdating )
				? DEFAULT_WORDPRESS_VERSION
				: currentWpVersion,
		[ selectedSite, currentWpVersion ]
	);
	const [ selectedWpVersion, setSelectedWpVersion ] = useState( () => getEffectiveWpVersion() );
	const [ useCustomDomain, setUseCustomDomain ] = useState( Boolean( selectedSite?.customDomain ) );
	const [ customDomain, setCustomDomain ] = useState< string | null >(
		selectedSite?.customDomain ?? null
	);
	const [ customDomainError, setCustomDomainError ] = useState( '' );
	const [ existingDomainNames, setExistingDomainNames ] = useState< string[] >( [] );
	const [ enableHttps, setEnableHttps ] = useState( false );
	const [ activeTab, setActiveTab ] = useState( editModalInitialTab || 'general' );
	const isFormTab = useMemo(
		() => activeTab === 'general' || activeTab === 'debugging',
		[ activeTab ]
	);
	const environmentTypeOptions = useMemo< { label: string; value: WpEnvironmentType }[] >(
		() => [
			{ label: __( 'Local' ), value: WP_ENVIRONMENT_TYPE_LOCAL },
			{ label: __( 'Development' ), value: WP_ENVIRONMENT_TYPE_DEVELOPMENT },
			{ label: __( 'Staging' ), value: WP_ENVIRONMENT_TYPE_STAGING },
			{ label: __( 'Production' ), value: WP_ENVIRONMENT_TYPE_PRODUCTION },
		],
		[ __ ]
	);

	useEffect( () => {
		getIpcApi()
			.getAllCustomDomains()
			.then( ( domains ) => {
				const domainsWithoutSelectedSite = domains.filter(
					( domain ) => domain !== selectedSite?.customDomain
				);
				setExistingDomainNames( domainsWithoutSelectedSite );
			} )
			.catch( () => {
				// Do nothing
			} );
	}, [ selectedSite?.customDomain ] );

	useEffect( () => {
		getIpcApi()
			.getXdebugEnabledSite()
			.then( setXdebugEnabledSite )
			.catch( () => {
				// Do nothing
			} );
	}, [ selectedSite ] );

	const generatedDomainName = generateCustomDomainFromSiteName( siteName );
	const usedCustomDomain = ! useCustomDomain ? customDomain : undefined;
	const adminUsernameError = validateAdminUsername( adminUsername );
	const adminPasswordError = ! adminPassword.trim() ? __( 'Admin password is required' ) : '';
	const adminEmailError = validateAdminEmail( adminEmail );
	const isUsernameChanged =
		! adminUsernameError && adminUsername !== ( selectedSite?.adminUsername ?? 'admin' );
	const isFormUnchanged =
		!! selectedSite &&
		selectedSite.name === siteName &&
		selectedSite.phpVersion === selectedPhpVersion &&
		getSiteRuntime( selectedSite ) === selectedRuntime &&
		getSiteFileAccess( selectedSite ) === usedFileAccess &&
		getEffectiveWpVersion() === selectedWpVersion &&
		Boolean( selectedSite.customDomain ) === useCustomDomain &&
		usedCustomDomain === customDomain &&
		!! selectedSite.enableHttps === ( !! usedCustomDomain && enableHttps ) &&
		!! selectedSite.enableXdebug === enableXdebug &&
		( selectedSite.adminUsername ?? 'admin' ) === adminUsername &&
		( decodePassword( selectedSite.adminPassword ?? '' ) || 'password' ) === adminPassword &&
		( selectedSite.adminEmail || 'admin@localhost.com' ) === adminEmail &&
		!! selectedSite.enableDebugLog === enableDebugLog &&
		!! selectedSite.enableDebugDisplay === enableDebugDisplay &&
		!! selectedSite.enableScriptDebug === enableScriptDebug &&
		getWpEnvironmentType( selectedSite ) === environmentType;
	const hasValidationErrors =
		! selectedSite ||
		! siteName.trim() ||
		( useCustomDomain && !! customDomainError ) ||
		!! adminUsernameError ||
		!! adminPasswordError ||
		!! adminEmailError;

	const resetFormState = useCallback( () => {
		if ( ! selectedSite ) {
			return;
		}
		setSiteName( selectedSite.name );
		setSelectedRuntime( getSiteRuntime( selectedSite ) );
		setSelectedFileAccess( getSiteFileAccess( selectedSite ) );
		setSelectedPhpVersion( resolvePhpVersion( selectedSite.phpVersion ) );
		setSelectedWpVersion( getEffectiveWpVersion() );
		setUseCustomDomain( Boolean( selectedSite.customDomain ) );
		setCustomDomain( selectedSite.customDomain ?? null );
		setCustomDomainError( '' );
		setErrorUpdatingWpVersion( null );
		setEnableHttps( selectedSite.enableHttps ?? false );
		setEnableXdebug( selectedSite.enableXdebug ?? false );
		setAdminUsername( selectedSite.adminUsername ?? 'admin' );
		setAdminPassword( decodePassword( selectedSite.adminPassword ?? '' ) || 'password' );
		setAdminEmail( selectedSite.adminEmail || 'admin@localhost.com' );
		setEnableDebugLog( selectedSite.enableDebugLog ?? false );
		setEnableDebugDisplay( selectedSite.enableDebugDisplay ?? false );
		setEnableScriptDebug( selectedSite.enableScriptDebug ?? false );
		setEnvironmentType( getWpEnvironmentType( selectedSite ) );
	}, [
		selectedSite,
		getEffectiveWpVersion,
		setAdminEmail,
		setAdminPassword,
		setAdminUsername,
		setCustomDomain,
		setCustomDomainError,
		setEnableDebugDisplay,
		setEnableDebugLog,
		setEnableScriptDebug,
		setEnvironmentType,
		setEnableHttps,
		setEnableXdebug,
		setErrorUpdatingWpVersion,
		setSelectedPhpVersion,
		setSelectedWpVersion,
		setSiteName,
		setUseCustomDomain,
	] );

	const onSiteEdit = async ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! selectedSite?.id ) {
			return;
		}
		setIsEditingSite( true );
		setErrorUpdatingWpVersion( null );

		const hasWpVersionChanged = selectedWpVersion !== getEffectiveWpVersion();
		const hasPhpVersionChanged = selectedPhpVersion !== selectedSite.phpVersion;
		const hasRuntimeChanged = selectedRuntime !== getSiteRuntime( selectedSite );
		const hasFileAccessChanged = usedFileAccess !== getSiteFileAccess( selectedSite );
		const hasXdebugChanged = enableXdebug !== ( selectedSite.enableXdebug ?? false );
		const hasDebugLogChanged = enableDebugLog !== ( selectedSite.enableDebugLog ?? false );
		const hasDebugDisplayChanged =
			enableDebugDisplay !== ( selectedSite.enableDebugDisplay ?? false );
		const hasScriptDebugChanged = enableScriptDebug !== ( selectedSite.enableScriptDebug ?? false );
		const hasEnvironmentTypeChanged = environmentType !== getWpEnvironmentType( selectedSite );
		const hasDomainChanged =
			Boolean( selectedSite.customDomain ) !== useCustomDomain ||
			( useCustomDomain && customDomain !== selectedSite.customDomain );
		const hasHttpsChanged =
			useCustomDomain && enableHttps !== ( selectedSite.enableHttps ?? false );
		const hasCredentialsChanged =
			adminUsername !== ( selectedSite.adminUsername ?? 'admin' ) ||
			adminPassword !== ( decodePassword( selectedSite.adminPassword ?? '' ) || 'password' ) ||
			adminEmail !== ( selectedSite.adminEmail || 'admin@localhost.com' );

		const needsRestart =
			selectedSite.running &&
			siteNeedsRestart( {
				domainChanged: hasDomainChanged,
				httpsChanged: hasHttpsChanged,
				phpChanged: hasPhpVersionChanged,
				wpChanged: hasWpVersionChanged,
				runtimeChanged: hasRuntimeChanged,
				fileAccessChanged: hasFileAccessChanged,
				xdebugChanged: hasXdebugChanged,
				credentialsChanged: hasCredentialsChanged,
				debugLogChanged: hasDebugLogChanged,
				debugDisplayChanged: hasDebugDisplayChanged,
				scriptDebugChanged: hasScriptDebugChanged,
				environmentTypeChanged: hasEnvironmentTypeChanged,
			} );
		setNeedsRestart( needsRestart );

		try {
			// Determine custom domain setting
			let usedCustomDomain = useCustomDomain && customDomain ? customDomain : undefined;
			if ( useCustomDomain && ! customDomain ) {
				usedCustomDomain = generateCustomDomainFromSiteName( siteName ?? '' );
			}

			await updateSite(
				{
					...selectedSite,
					name: siteName,
					phpVersion: selectedPhpVersion,
					runtime: selectedRuntime,
					fileAccess: usedFileAccess,
					isWpAutoUpdating: selectedWpVersion === DEFAULT_WORDPRESS_VERSION,
					customDomain: usedCustomDomain,
					enableHttps: !! usedCustomDomain && enableHttps,
					enableXdebug,
					adminUsername,
					// Encode for IPC storage; IPC handler decodes back to plain text for the CLI set command
					adminPassword: encodePassword( adminPassword ),
					adminEmail,
					enableDebugLog,
					enableDebugDisplay,
					enableScriptDebug,
					environmentType,
				},
				hasWpVersionChanged ? selectedWpVersion : undefined
			);

			onSave();
			closeModal();
			resetFormState();
		} catch ( e ) {
			setErrorUpdatingWpVersion( ( e as Error )?.message );
		}
		setIsEditingSite( false );
		setNeedsRestart( false );
	};

	const getEditSiteButtonText = () => {
		if ( ! isEditingSite ) {
			return __( 'Save' );
		}
		return needsRestart ? __( 'Saving and restarting…' ) : __( 'Saving…' );
	};

	const handleCustomDomainChange = useCallback(
		( value: string | null ) => {
			setCustomDomain( value );
			setCustomDomainError(
				getDomainNameValidationError( useCustomDomain, value, existingDomainNames )
			);
		},
		[ useCustomDomain, setCustomDomain, setCustomDomainError, existingDomainNames ]
	);

	return (
		<>
			{ isEditModalOpen && (
				<Modal
					size="medium"
					title={ __( 'Edit site' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ closeModal }
					className={ cx(
						'[&_[role="document"]]:px-0',
						isEditingSite &&
							'[&_[aria-label="Close"]_svg]:opacity-50 [&_[aria-label="Close"]]:cursor-not-allowed'
					) }
				>
					<form onSubmit={ onSiteEdit }>
						<TabPanel
							className={ cx(
								'w-full [&>[role=tabpanel]]:overflow-auto',
								isFormTab ? '[&>[role=tabpanel]]:h-64' : '[&>[role=tabpanel]]:h-80'
							) }
							tabs={ [
								{ name: 'general', title: __( 'General' ) },
								{ name: 'debugging', title: __( 'Debugging' ) },
								{ name: 'skills', title: __( 'Skills' ) },
								{ name: 'instructions', title: __( 'Instructions' ) },
							] }
							initialTabName={ editModalInitialTab }
							onSelect={ ( tabName: string ) => setActiveTab( tabName ) }
							orientation="horizontal"
						>
							{ ( { name } ) => (
								<div className="mt-6 px-8 flex flex-col">
									{ name === 'general' && (
										<>
											<label className="flex flex-col gap-1.5 leading-4 mb-6">
												<span className="font-semibold">{ __( 'Site name' ) }</span>
												<TextControlComponent
													disabled={ isEditingSite }
													onChange={ setSiteName }
													value={ siteName }
												></TextControlComponent>
											</label>

											<div className="flex flex-row gap-x-6">
												<label
													htmlFor="php-version-select"
													className="flex flex-1 flex-col gap-1.5 leading-4"
												>
													<span className="inline-flex items-center gap-2 font-semibold">
														{ __( 'PHP version' ) }
														{ phpVersionWarning && (
															<Tooltip text={ phpVersionWarning } placement="top-start">
																<span
																	role="img"
																	aria-label={ __( 'PHP version warning' ) }
																	tabIndex={ 0 }
																	className="inline-flex cursor-help items-center"
																>
																	<Icon
																		icon={ cautionFilled }
																		size={ 18 }
																		className="fill-[#f59e0b]"
																	/>
																</span>
															</Tooltip>
														) }
													</span>
													<SelectControl< SupportedPHPVersion >
														id="php-version-select"
														disabled={ isEditingSite }
														value={ selectedPhpVersion }
														options={ SupportedPHPVersions.map( ( version ) => ( {
															label: version,
															value: version,
														} ) ) }
														onChange={ ( version ) => setSelectedPhpVersion( version ) }
														__next40pxDefaultSize
														__nextHasNoMarginBottom
													/>
												</label>

												<WPVersionSelector
													selectedValue={ selectedWpVersion }
													onChange={ setSelectedWpVersion }
													disabled={ isEditingSite }
													errorMessage={ errorUpdatingWpVersion }
													extraOptions={ [
														{
															label: currentWpVersion,
															value: currentWpVersion,
														},
													] }
													fallbackOptions={ [
														{
															label: currentWpVersion,
															value: currentWpVersion,
														},
													] }
												/>
											</div>
											{ errorUpdatingWpVersion && (
												<ErrorInformation className="mt-2">
													{ errorUpdatingWpVersion }
												</ErrorInformation>
											) }

											<div className="flex flex-row gap-x-6 mt-4">
												<label
													htmlFor="php-runtime-select"
													className="flex flex-1 flex-col gap-1.5 leading-4"
												>
													<span className="font-semibold">{ __( 'PHP runtime' ) }</span>
													<SelectControl< SiteRuntime >
														id="php-runtime-select"
														disabled={ isEditingSite }
														value={ selectedRuntime }
														options={ [
															/* translators: PHP runtime option, paired with "Sandbox". The compiled PHP binary that Studio bundles and runs natively on the machine. */
															{ label: __( 'Native' ), value: SITE_RUNTIME_NATIVE_PHP },
															/* translators: PHP runtime option, paired with "Native". Runs the site in an isolated WordPress Playground sandbox. */
															{ label: __( 'Sandbox' ), value: SITE_RUNTIME_PLAYGROUND },
														] }
														onChange={ ( value ) => setSelectedRuntime( value ) }
														__next40pxDefaultSize
														__nextHasNoMarginBottom
													/>
													<span className="text-frame-text-secondary text-xs">
														<RuntimeDescription runtime={ selectedRuntime } learnMoreLink />
													</span>
												</label>

												<label
													htmlFor="file-access-select"
													className="flex flex-1 flex-col gap-1.5 leading-4"
												>
													<span className="font-semibold">{ __( 'File access' ) }</span>
													<SelectControl< SiteFileAccess >
														id="file-access-select"
														disabled={
															isEditingSite || selectedRuntime === SITE_RUNTIME_PLAYGROUND
														}
														value={ usedFileAccess }
														options={ [
															{
																label: __( 'Site directory' ),
																value: SITE_FILE_ACCESS_SITE_DIRECTORY,
															},
															{ label: __( 'All files' ), value: SITE_FILE_ACCESS_ALL_FILES },
														] }
														onChange={ ( value ) => setSelectedFileAccess( value ) }
														__next40pxDefaultSize
														__nextHasNoMarginBottom
													/>
													<span className="text-frame-text-secondary text-xs">
														<FileAccessDescription
															runtime={ selectedRuntime }
															fileAccess={ usedFileAccess }
														/>
													</span>
												</label>
											</div>

											<div className="flex flex-col gap-2 mt-4">
												<div className="flex items-center gap-2">
													<input
														type="checkbox"
														id="use-custom-domain"
														checked={ useCustomDomain }
														onChange={ ( e ) => setUseCustomDomain( e.target.checked ) }
														disabled={ isEditingSite }
													/>
													<label htmlFor="use-custom-domain">{ __( 'Use custom domain' ) }</label>
												</div>

												{ useCustomDomain && (
													<div className="flex flex-col gap-2 mt-2">
														<label htmlFor="custom-domain" className="font-semibold">
															{ __( 'Domain name' ) }
														</label>
														<TextControlComponent
															id="custom-domain"
															value={ customDomain ?? generatedDomainName }
															onChange={ handleCustomDomainChange }
															disabled={ isEditingSite }
														/>
														{ customDomainError && (
															<ErrorInformation className="mt-1">
																{ customDomainError }
															</ErrorInformation>
														) }
														<div className="text-frame-text-secondary text-xs mt-1">
															{ __(
																'Your system password will be required to set up the domain.'
															) }
														</div>
													</div>
												) }

												{ useCustomDomain && (
													<div className="flex items-center gap-2 mt-4">
														<input
															type="checkbox"
															id="enable-https"
															checked={ enableHttps }
															onChange={ ( e ) => setEnableHttps( e.target.checked ) }
															disabled={ isEditingSite }
														/>
														<label htmlFor="enable-https">{ __( 'Enable HTTPS' ) }</label>
													</div>
												) }

												{ ! isCertificateTrusted && useCustomDomain && (
													<div className="text-frame-text-secondary text-xs mt-2">
														{ __(
															'You need to manually add the Studio certificate authority to your keychain and trust it.'
														) }{ ' ' }
														<LearnHowLink docsLinksKey="docsSslInStudio" />
													</div>
												) }
											</div>

											<div className="flex flex-col gap-2 mt-4">
												<span className="font-semibold">{ __( 'Admin credentials' ) }</span>
												<div className="grid grid-cols-2 gap-4">
													<div className="flex flex-col gap-1.5 leading-4">
														<label className="text-sm" htmlFor="edit-admin-username">
															{ __( 'Username' ) }
														</label>
														<TextControlComponent
															id="edit-admin-username"
															disabled={ isEditingSite }
															value={ adminUsername }
															onChange={ setAdminUsername }
															className={ adminUsernameError ? '[&_input]:!border-red-500' : '' }
														/>
													</div>
													<div className="flex flex-col gap-1.5 leading-4">
														<label className="text-sm" htmlFor="edit-admin-password">
															{ __( 'Password' ) }
														</label>
														<PasswordControl
															id="edit-admin-password"
															disabled={ isEditingSite }
															value={ adminPassword }
															onChange={ setAdminPassword }
															className={ adminPasswordError ? '[&_input]:!border-red-500' : '' }
														/>
													</div>
												</div>
												{ ( adminUsernameError || adminPasswordError ) && (
													<span className="text-red-500 text-xs">
														{ adminUsernameError || adminPasswordError }
													</span>
												) }
												{ isUsernameChanged && (
													<span className="text-frame-text-secondary text-xs">
														{ __(
															'A new admin user will be created. WordPress does not support renaming usernames.'
														) }
													</span>
												) }
											</div>

											<div className="flex flex-col gap-1.5 leading-4 mt-4">
												<label className="text-sm" htmlFor="edit-admin-email">
													{ __( 'Email' ) }
												</label>
												<TextControlComponent
													id="edit-admin-email"
													disabled={ isEditingSite }
													value={ adminEmail }
													onChange={ setAdminEmail }
													placeholder="admin@localhost.com"
													className={ adminEmailError ? '[&_input]:!border-red-500' : '' }
												/>
												<div className="h-4">
													{ adminEmailError && (
														<span className="text-red-500 text-xs">{ adminEmailError }</span>
													) }
												</div>
											</div>
										</>
									) }

									{ name === 'debugging' && (
										<>
											<div
												className={ cx(
													'flex flex-col gap-2',
													isEditingSite ||
														( xdebugEnabledSite && xdebugEnabledSite.id !== selectedSite?.id )
														? 'opacity-50 cursor-not-allowed'
														: ''
												) }
											>
												<Tooltip
													disabled={
														! xdebugEnabledSite || xdebugEnabledSite.id === selectedSite?.id
													}
													text={ sprintf(
														__(
															'Xdebug is currently enabled for "%s" site. Disable it there first to enable it for this site.'
														),
														xdebugEnabledSite?.name || ''
													) }
													placement="top-start"
												>
													<div>
														<div className="flex items-center gap-2">
															<input
																type="checkbox"
																id="enable-xdebug"
																checked={ enableXdebug }
																onChange={ ( e ) => setEnableXdebug( e.target.checked ) }
																disabled={
																	isEditingSite ||
																	!! (
																		xdebugEnabledSite && xdebugEnabledSite.id !== selectedSite?.id
																	)
																}
															/>
															<label
																htmlFor="enable-xdebug"
																className={ cx(
																	isEditingSite ||
																		( xdebugEnabledSite &&
																			xdebugEnabledSite.id !== selectedSite?.id )
																		? 'cursor-not-allowed'
																		: ''
																) }
															>
																{ __( 'Enable Xdebug' ) }
															</label>
														</div>
														<div className="text-frame-text-secondary text-xs mt-2">
															{ createInterpolateElement(
																__(
																	'Enable PHP debugging with Xdebug. Only one site can have Xdebug enabled at a time. Note that Xdebug may slow down site performance. <learn_more_link />'
																),
																{
																	learn_more_link: <LearnMoreLink docsLinksKey="docsXdebug" />,
																}
															) }
														</div>
													</div>
												</Tooltip>
											</div>

											<div
												className={ cx(
													'flex flex-col gap-2 mt-4',
													isEditingSite ? 'opacity-50 cursor-not-allowed' : ''
												) }
											>
												<div className="flex items-center gap-2">
													<input
														type="checkbox"
														id="enable-debug-log"
														checked={ enableDebugLog }
														onChange={ ( e ) => setEnableDebugLog( e.target.checked ) }
														disabled={ isEditingSite }
													/>
													<label
														htmlFor="enable-debug-log"
														className={ cx( isEditingSite ? 'cursor-not-allowed' : '' ) }
													>
														{ __( 'Enable debug log' ) }
													</label>
												</div>
												<div className="text-frame-text-secondary text-xs mt-1">
													{ __(
														"Log PHP errors and warnings to a debug.log file in your site's wp-content directory by setting the WP_DEBUG_LOG constant."
													) }
												</div>
											</div>

											<div
												className={ cx(
													'flex flex-col gap-2 mt-4',
													isEditingSite ? 'opacity-50 cursor-not-allowed' : ''
												) }
											>
												<div className="flex items-center gap-2">
													<input
														type="checkbox"
														id="enable-debug-display"
														checked={ enableDebugDisplay }
														onChange={ ( e ) => setEnableDebugDisplay( e.target.checked ) }
														disabled={ isEditingSite }
													/>
													<label
														htmlFor="enable-debug-display"
														className={ cx( isEditingSite ? 'cursor-not-allowed' : '' ) }
													>
														{ __( 'Show errors in browser' ) }
													</label>
												</div>
												<div className="text-frame-text-secondary text-xs mt-1">
													{ __(
														'Display PHP errors and warnings directly in the browser by setting the WP_DEBUG_DISPLAY constant.'
													) }
												</div>
											</div>

											<div
												className={ cx(
													'flex flex-col gap-2 mt-4',
													isEditingSite ? 'opacity-50 cursor-not-allowed' : ''
												) }
											>
												<div className="flex items-center gap-2">
													<input
														type="checkbox"
														id="enable-script-debug"
														checked={ enableScriptDebug }
														onChange={ ( e ) => setEnableScriptDebug( e.target.checked ) }
														disabled={ isEditingSite }
													/>
													<label
														htmlFor="enable-script-debug"
														className={ cx( isEditingSite ? 'cursor-not-allowed' : '' ) }
													>
														{ __( 'Enable script debug' ) }
													</label>
												</div>
												<div className="text-frame-text-secondary text-xs mt-1">
													{ __(
														'Load the development versions of core CSS and JavaScript instead of the minified files by setting the SCRIPT_DEBUG constant. Useful for reading React errors in the block editor.'
													) }
												</div>
											</div>

											<div className="flex flex-col gap-2 mt-4">
												<label
													htmlFor="environment-type-select"
													className="flex flex-col gap-1.5 leading-4"
												>
													<span className="font-semibold">{ __( 'Environment type' ) }</span>
													<SelectControl< WpEnvironmentType >
														id="environment-type-select"
														disabled={ isEditingSite }
														value={ environmentType }
														options={ environmentTypeOptions }
														onChange={ ( value ) => setEnvironmentType( value ) }
														__next40pxDefaultSize
														__nextHasNoMarginBottom
													/>
												</label>
												<div className="text-frame-text-secondary text-xs">
													{ __(
														'Sets the WP_ENVIRONMENT_TYPE constant, which determines the value returned by wp_get_environment_type(). Plugins and themes use it to vary their behavior between local, staging, and production sites.'
													) }
												</div>
											</div>
										</>
									) }
									{ name === 'skills' && selectedSite && (
										<WordPressSkillsPanel siteId={ selectedSite.id } />
									) }
									{ name === 'instructions' && selectedSite && (
										<AgentInstructionsPanel siteId={ selectedSite.id } />
									) }
								</div>
							) }
						</TabPanel>

						{ isFormTab && (
							<div className="flex flex-row justify-end gap-x-5 mt-8 px-8">
								<Button onClick={ closeModal } disabled={ isEditingSite } variant="tertiary">
									{ __( 'Cancel' ) }
								</Button>
								<Button
									type="submit"
									variant="primary"
									isBusy={ isEditingSite }
									disabled={ isEditingSite || isFormUnchanged || hasValidationErrors }
								>
									{ getEditSiteButtonText() }
								</Button>
							</div>
						) }
						<div className="components-popover__fallback-container"></div>
					</form>
				</Modal>
			) }
			<Button
				disabled={ ! selectedSite }
				className="shrink-0"
				onClick={ () => {
					setEditModalInitialTab( 'general' );
					setIsEditModalOpen( true );
					resetFormState();
				} }
				label={ __( 'Edit site' ) }
				variant="secondary"
			>
				{ __( 'Edit site' ) }
			</Button>
		</>
	);
};
EditSiteDetails.displayName = 'EditSiteDetails';

export default EditSiteDetails;
