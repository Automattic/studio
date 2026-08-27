import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import {
	generatePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import {
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { getAutoUpdateVersionLabel } from '@studio/common/lib/wordpress-version-labels';
import {
	RecommendedPHPVersion,
	SupportedPHPVersion,
	SupportedPHPVersions,
} from '@studio/common/types/php-versions';
import { Icon, SelectControl, Notice } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf, _n } from '@wordpress/i18n';
import { cautionFilled, chevronRight, chevronDown, chevronLeft } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useState, useEffect, useCallback, useMemo, useRef, RefObject } from 'react';
import Button from 'src/components/button';
import { FormPathInputComponent } from 'src/components/form-path-input';
import { LearnMoreLink, LearnHowLink } from 'src/components/learn-more';
import PasswordControl from 'src/components/password-control';
import { SiteFormError } from 'src/components/site-form-error';
import TextControlComponent from 'src/components/text-control';
import { WPVersionSelector } from 'src/components/wp-version-selector';
import { cx } from 'src/lib/cx';
import { FileAccessDescription, RuntimeDescription } from 'src/lib/site-runtime-copy';
import { useCheckCertificateTrustQuery } from 'src/stores/certificate-trust-api';
import type { BlueprintPreferredVersions } from '@studio/common/lib/blueprint-validation';
import type { CreateSiteFormValues, PathValidationResult } from 'src/hooks/use-add-site';

interface CreateSiteFormProps {
	/** Initial values and async updates (syncs before user interaction) */
	defaultValues?: {
		siteName?: string;
		sitePath?: string;
		phpVersion?: SupportedPHPVersion;
		wpVersion?: string;
	};
	/** Opens folder picker to select site path */
	onSelectPath?: ( currentPath: string ) => Promise< PathValidationResult | null >;
	/** Generates proposed path when site name changes */
	onSiteNameChange?: ( name: string ) => Promise< PathValidationResult >;
	/** Existing domain names for validation */
	existingDomainNames?: string[];
	/** Blueprint preferred versions for warning display */
	blueprintPreferredVersions?: BlueprintPreferredVersions;
	/** Blueprint suggested domain from defineSiteUrl step */
	blueprintSuggestedDomain?: string;
	/** Blueprint suggested HTTPS setting from defineSiteUrl step */
	blueprintSuggestedHttps?: boolean;
	/** Whether the blueprint requires a custom domain (e.g., multisite) */
	blueprintRequiresCustomDomain?: boolean;
	/** Blueprint login credentials for pre-filling admin fields */
	blueprintCredentials?: { adminUsername?: string; adminPassword?: string };
	/** Called when form is submitted */
	onSubmit: ( values: CreateSiteFormValues ) => void;
	/** Called when form validity changes */
	onValidityChange?: ( isValid: boolean ) => void;
	/** Ref to form element for programmatic submission */
	formRef?: RefObject< HTMLFormElement | null >;
}

export const CreateSiteForm = ( {
	defaultValues = {},
	onSelectPath,
	onSiteNameChange,
	existingDomainNames = [],
	blueprintPreferredVersions,
	blueprintSuggestedDomain,
	blueprintSuggestedHttps,
	blueprintRequiresCustomDomain,
	blueprintCredentials,
	onSubmit,
	onValidityChange,
	formRef,
}: CreateSiteFormProps ) => {
	const { __, isRTL } = useI18n();
	const { data: isCertificateTrusted } = useCheckCertificateTrustQuery();
	const [ siteName, setSiteName ] = useState( defaultValues.siteName ?? '' );
	const [ sitePath, setSitePath ] = useState( defaultValues.sitePath ?? '' );
	const [ phpVersion, setPhpVersion ] = useState< SupportedPHPVersion >(
		defaultValues.phpVersion && SupportedPHPVersions.includes( defaultValues.phpVersion )
			? defaultValues.phpVersion
			: RecommendedPHPVersion
	);
	const [ wpVersion, setWpVersion ] = useState(
		defaultValues.wpVersion ?? DEFAULT_WORDPRESS_VERSION
	);
	// New sites default to the native PHP runtime.
	const [ selectedRuntime, setSelectedRuntime ] =
		useState< SiteRuntime >( SITE_RUNTIME_NATIVE_PHP );
	const [ selectedFileAccess, setSelectedFileAccess ] = useState< SiteFileAccess >(
		SITE_FILE_ACCESS_SITE_DIRECTORY
	);
	// The sandbox only has access to the site directory, so "all files" is
	// forced back to "site directory" when the sandbox mode is selected.
	const usedFileAccess =
		selectedRuntime === SITE_RUNTIME_PLAYGROUND
			? SITE_FILE_ACCESS_SITE_DIRECTORY
			: selectedFileAccess;
	const [ useCustomDomain, setUseCustomDomain ] = useState( false );
	const [ customDomain, setCustomDomain ] = useState< string | null >( null );
	const [ enableHttps, setEnableHttps ] = useState( false );
	const [ adminUsername, setAdminUsername ] = useState(
		blueprintCredentials?.adminUsername ?? 'admin'
	);
	const [ adminPassword, setAdminPassword ] = useState(
		() => blueprintCredentials?.adminPassword ?? generatePassword()
	);
	const [ adminEmail, setAdminEmail ] = useState( 'admin@localhost.com' );

	const [ pathError, setPathError ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );
	const [ customDomainError, setCustomDomainError ] = useState( '' );
	const [ hasCustomPath, setHasCustomPath ] = useState( false );

	const [ isAdvancedSettingsVisible, setAdvancedSettingsVisible ] = useState( false );

	// Prevent overwriting user input when defaultValues change asynchronously
	const hasUserInteracted = useRef( false );
	const hasUserEditedCredentials = useRef( false );

	const shouldShowCustomDomainError = useCustomDomain && customDomainError;
	const adminUsernameError = validateAdminUsername( adminUsername );
	const adminPasswordError = ! adminPassword.trim() ? __( 'Admin password is required' ) : '';
	const adminEmailError = validateAdminEmail( adminEmail );

	// Sync name/path only before user interaction (allows async loading)
	useEffect( () => {
		if ( hasUserInteracted.current ) {
			return;
		}

		if ( defaultValues.siteName !== undefined ) {
			setSiteName( defaultValues.siteName );
		}
		if ( defaultValues.sitePath !== undefined ) {
			setSitePath( defaultValues.sitePath );
		}
	}, [ defaultValues.siteName, defaultValues.sitePath ] );

	// Sync versions from defaultValues (initial load and deeplink flows)
	useEffect( () => {
		if ( defaultValues.phpVersion !== undefined ) {
			setPhpVersion(
				SupportedPHPVersions.includes( defaultValues.phpVersion )
					? defaultValues.phpVersion
					: RecommendedPHPVersion
			);
		}
		if ( defaultValues.wpVersion !== undefined ) {
			setWpVersion( defaultValues.wpVersion );
		}
	}, [ defaultValues.phpVersion, defaultValues.wpVersion ] );

	// Sync admin credentials from Blueprint when they change (only if user hasn't edited)
	useEffect( () => {
		if ( hasUserEditedCredentials.current ) {
			return;
		}
		if ( blueprintCredentials?.adminUsername !== undefined ) {
			setAdminUsername( blueprintCredentials.adminUsername );
			setAdvancedSettingsVisible( true );
		}
		if ( blueprintCredentials?.adminPassword !== undefined ) {
			setAdminPassword( blueprintCredentials.adminPassword );
			setAdvancedSettingsVisible( true );
		}
	}, [ blueprintCredentials?.adminUsername, blueprintCredentials?.adminPassword ] );

	useEffect( () => {
		if ( hasUserInteracted.current || ! blueprintSuggestedDomain ) {
			return;
		}
		setUseCustomDomain( true );
		setCustomDomain( blueprintSuggestedDomain );
		if ( blueprintSuggestedHttps !== undefined ) {
			setEnableHttps( blueprintSuggestedHttps );
		}
		setAdvancedSettingsVisible( true );
	}, [ blueprintSuggestedDomain, blueprintSuggestedHttps ] );

	useEffect( () => {
		if ( ! blueprintRequiresCustomDomain ) {
			return;
		}
		setUseCustomDomain( true );
		setAdvancedSettingsVisible( true );
	}, [ blueprintRequiresCustomDomain ] );

	useEffect( () => {
		if ( useCustomDomain && isCertificateTrusted ) {
			setEnableHttps( true );
		}
	}, [ useCustomDomain, isCertificateTrusted ] );

	// Validate custom domain when useCustomDomain or customDomain changes
	// Note: existingDomainNames is intentionally not in deps to avoid re-validation when the list loads
	useEffect( () => {
		if ( useCustomDomain ) {
			const generatedDomainName = generateCustomDomainFromSiteName( siteName );
			const domainToValidate = customDomain ?? generatedDomainName;
			setCustomDomainError(
				getDomainNameValidationError( useCustomDomain, domainToValidate, existingDomainNames || [] )
			);
		} else {
			setCustomDomainError( '' );
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ useCustomDomain, customDomain, siteName ] );

	// Notify parent of form validity changes
	const previousIsValid = useRef< boolean | undefined >( undefined );
	useEffect( () => {
		if ( ! onValidityChange ) {
			return;
		}

		const hasErrors =
			! siteName.trim() ||
			!! pathError ||
			( useCustomDomain && !! customDomainError ) ||
			! adminUsername.trim() ||
			! adminPassword.trim() ||
			!! adminEmailError;
		const isValid = ! hasErrors;

		// Only notify if validity has actually changed
		if ( previousIsValid.current !== isValid ) {
			previousIsValid.current = isValid;
			onValidityChange( isValid );
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		siteName,
		pathError,
		customDomainError,
		useCustomDomain,
		adminUsername,
		adminPassword,
		adminEmail,
	] );

	const handleSiteNameChange = useCallback(
		async ( name: string ) => {
			hasUserInteracted.current = true;
			setSiteName( name );

			// Only generate path if user hasn't manually selected a custom path
			if ( onSiteNameChange && ! hasCustomPath ) {
				const result = await onSiteNameChange( name );
				if ( result.error ) {
					setPathError( result.error );
				} else {
					setPathError( '' );
				}
				setDoesPathContainWordPress( ! result.isEmpty && result.isWordPress );
				setSitePath( result.path );
			}
		},
		[
			onSiteNameChange,
			hasCustomPath,
			setDoesPathContainWordPress,
			setPathError,
			setSiteName,
			setSitePath,
		]
	);

	const handleSelectPath = useCallback( async () => {
		if ( ! onSelectPath || ! onSiteNameChange ) return;

		hasUserInteracted.current = true;
		// Pass the current path to the dialog (empty if no custom path yet)
		const currentPath = hasCustomPath ? sitePath : '';
		const result = await onSelectPath( currentPath );
		if ( ! result ) return;

		// Check if user selected the default directory (parent of the proposed path)
		// We need to calculate what the proposed path WOULD BE for the current site name
		const proposedPathResult = await onSiteNameChange( siteName );
		const proposedPath = proposedPathResult.path;
		const pathResetToDefault =
			!! proposedPath &&
			result.path === proposedPath.substring( 0, proposedPath.lastIndexOf( '/' ) );

		setHasCustomPath( ! pathResetToDefault );
		// Clear path on reset to trigger regeneration when site name changes
		setSitePath( pathResetToDefault ? '' : result.path );

		if ( result.error ) {
			setPathError( result.error );
		} else {
			setPathError( '' );
		}
		setDoesPathContainWordPress( ! result.isEmpty && result.isWordPress );

		if ( result.name && ! siteName ) {
			setSiteName( result.name );
		}
	}, [
		onSelectPath,
		onSiteNameChange,
		sitePath,
		siteName,
		hasCustomPath,
		setDoesPathContainWordPress,
		setHasCustomPath,
		setPathError,
		setSiteName,
		setSitePath,
	] );

	const handleCustomDomainChange = useCallback(
		( value: string ) => {
			setCustomDomain( value || null );
			setCustomDomainError(
				getDomainNameValidationError( useCustomDomain, value, existingDomainNames )
			);
		},
		[ useCustomDomain, existingDomainNames ]
	);

	const formValues = useMemo< CreateSiteFormValues >(
		() => ( {
			siteName,
			sitePath,
			phpVersion,
			wpVersion,
			runtime: selectedRuntime,
			fileAccess: usedFileAccess,
			useCustomDomain,
			customDomain,
			enableHttps,
			adminUsername: adminUsername || undefined,
			adminPassword: adminPassword || undefined,
			adminEmail,
		} ),
		[
			siteName,
			sitePath,
			phpVersion,
			wpVersion,
			selectedRuntime,
			usedFileAccess,
			useCustomDomain,
			customDomain,
			enableHttps,
			adminUsername,
			adminPassword,
			adminEmail,
		]
	);

	const handleFormSubmit = useCallback(
		( event: FormEvent ) => {
			event.preventDefault();
			onSubmit( formValues );
		},
		[ onSubmit, formValues ]
	);

	const errorCount = [
		pathError,
		shouldShowCustomDomainError,
		adminUsernameError,
		adminPasswordError,
		adminEmailError,
	].filter( Boolean ).length;

	const handleAdvancedSettingsClick = () => {
		setAdvancedSettingsVisible( ! isAdvancedSettingsVisible );
	};

	let chevronIcon;
	if ( isAdvancedSettingsVisible ) {
		chevronIcon = chevronDown;
	} else if ( isRTL() ) {
		chevronIcon = chevronLeft;
	} else {
		chevronIcon = chevronRight;
	}

	const generatedDomainName = generateCustomDomainFromSiteName( siteName );

	const showPhpVersionWarning =
		blueprintPreferredVersions?.php && blueprintPreferredVersions.php !== phpVersion;

	const showWpVersionWarning =
		blueprintPreferredVersions?.wp && blueprintPreferredVersions.wp !== wpVersion;

	const showBlueprintVersionWarning = showPhpVersionWarning || showWpVersionWarning;
	const warningCount = [ showPhpVersionWarning, showWpVersionWarning ].filter( Boolean ).length;

	const showAdvancedSettings = onSelectPath !== undefined;

	return (
		<form ref={ formRef } onSubmit={ handleFormSubmit }>
			<div className="flex flex-col">
				<label className="flex flex-col gap-1.5 leading-4 mb-6">
					<span className="font-semibold">{ __( 'Site name' ) }</span>
					<TextControlComponent
						onChange={ handleSiteNameChange }
						value={ siteName }
						onKeyDown={ ( event ) => {
							if ( event.key === 'Enter' ) {
								event.preventDefault();
								if ( errorCount === 0 ) {
									handleFormSubmit( event as FormEvent );
								}
							}
						} }
						data-testid="site-name-input"
					/>
				</label>

				{ showAdvancedSettings && (
					<>
						<div className="flex flex-row items-center mb-1">
							<Button
								className="pl-0 !text-frame-text-secondary"
								onClick={ handleAdvancedSettingsClick }
								data-testid="advanced-settings-button"
							>
								<Icon size={ 24 } icon={ chevronIcon } className={ pathError && 'text-red-500' } />
								<div
									className={ cx( 'text-[13px] leading-[16px] ml-2', pathError && 'text-red-500' ) }
								>
									{ __( 'Advanced settings' ) }
								</div>
							</Button>
							{ errorCount > 0 && (
								<span className="text-red-500 text-[13px] leading-[16px] ml-2 flex items-center">
									<Icon icon={ cautionFilled } size={ 16 } className="mr-1 fill-red-500" />
									{ sprintf(
										/* translators: %d: number of errors found */
										_n( '%d error found', '%d errors found', errorCount ),
										errorCount
									) }
								</span>
							) }
							{ warningCount > 0 && (
								<span className="text-amber-600 text-[13px] leading-[16px] ml-2 flex items-center">
									<Icon icon={ cautionFilled } size={ 16 } className="mr-1 fill-amber-600" />
									{ sprintf(
										/* translators: %d: number of warnings found */
										_n( '%d warning found', '%d warnings found', warningCount ),
										warningCount
									) }
								</span>
							) }
						</div>
						<div
							className={ cx(
								'transition-all duration-500 ease-in-out overflow-hidden flex flex-col gap-2 interpolate-size-allow-keywords',
								isAdvancedSettingsVisible ? 'h-auto opacity-100' : 'h-0 opacity-0'
							) }
						>
							<div className="flex flex-col gap-1.5 leading-4 py-4">
								<label className="font-semibold" htmlFor="local-path">
									{ __( 'Local path' ) }
								</label>
								<span className="text-frame-text-secondary text-xs">
									{ createInterpolateElement(
										__(
											'Select an empty directory or a directory with an existing WordPress site. <learn_more_link />'
										),
										{
											learn_more_link: <LearnMoreLink docsLinksKey="docsSites" />,
										}
									) }
								</span>
								<FormPathInputComponent
									tipMessage={
										doesPathContainWordPress
											? __( 'The existing WordPress site at this path will be added.' )
											: ''
									}
									error={ pathError }
									value={ sitePath }
									onClick={ handleSelectPath }
									id="local-path"
								/>
								<div className="grid grid-cols-2 gap-4 mt-4">
									<div className="flex flex-col gap-1.5 leading-4">
										<label className="font-semibold" htmlFor="php-version-select">
											{ __( 'PHP version' ) }
										</label>
										<SelectControl< SupportedPHPVersion >
											id="php-version-select"
											value={ phpVersion }
											options={ SupportedPHPVersions.map( ( version ) => ( {
												label: version,
												value: version,
											} ) ) }
											onChange={ ( value ) => setPhpVersion( value ) }
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
									</div>

									<WPVersionSelector
										selectedValue={ wpVersion }
										onChange={ setWpVersion }
										fallbackOptions={ [
											{ label: getAutoUpdateVersionLabel(), value: DEFAULT_WORDPRESS_VERSION },
										] }
										offlineMessage={ __(
											'You are currently offline so your site will be created with the latest version. Selecting a different WordPress version requires an internet connection.'
										) }
									/>
								</div>

								<div className="grid grid-cols-2 gap-4 mt-4">
									<div className="flex flex-col gap-1.5 leading-4">
										<label className="font-semibold" htmlFor="php-runtime-select">
											{ __( 'PHP runtime' ) }
										</label>
										<SelectControl< SiteRuntime >
											id="php-runtime-select"
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
									</div>

									<div className="flex flex-col gap-1.5 leading-4">
										<label className="font-semibold" htmlFor="file-access-select">
											{ __( 'File access' ) }
										</label>
										<SelectControl< SiteFileAccess >
											id="file-access-select"
											disabled={ selectedRuntime === SITE_RUNTIME_PLAYGROUND }
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
									</div>
								</div>

								<div className="flex flex-col gap-2 mt-4">
									<span className="font-semibold">{ __( 'Admin credentials' ) }</span>
									<div className="grid grid-cols-2 gap-4">
										<div className="flex flex-col gap-1.5 leading-4">
											<label className="text-sm" htmlFor="admin-username">
												{ __( 'Username' ) }
											</label>
											<TextControlComponent
												id="admin-username"
												value={ adminUsername }
												onChange={ ( value: string ) => {
													hasUserEditedCredentials.current = true;
													setAdminUsername( value );
												} }
												className={ adminUsernameError ? '[&_input]:!border-red-500' : '' }
											/>
										</div>

										<div className="flex flex-col gap-1.5 leading-4">
											<label className="text-sm" htmlFor="admin-password">
												{ __( 'Password' ) }
											</label>
											<PasswordControl
												id="admin-password"
												value={ adminPassword }
												onChange={ ( value: string ) => {
													hasUserEditedCredentials.current = true;
													setAdminPassword( value );
												} }
												className={ adminPasswordError ? '[&_input]:!border-red-500' : '' }
											/>
										</div>
									</div>
									{ ( adminUsernameError || adminPasswordError ) && (
										<span className="text-red-500 text-xs">
											{ adminUsernameError || adminPasswordError }
										</span>
									) }
								</div>

								<div className="flex flex-col gap-1.5 leading-4 mt-4">
									<label className="text-sm" htmlFor="admin-email">
										{ __( 'Email' ) }
									</label>
									<TextControlComponent
										id="admin-email"
										value={ adminEmail }
										onChange={ ( value: string ) => {
											hasUserEditedCredentials.current = true;
											setAdminEmail( value );
										} }
										placeholder="admin@localhost.com"
										className={ adminEmailError ? '[&_input]:!border-red-500' : '' }
									/>
									{ adminEmailError && (
										<span className="text-red-500 text-xs">{ adminEmailError }</span>
									) }
								</div>

								{ showBlueprintVersionWarning && (
									<Notice status="warning" isDismissible={ false } className="mt-4">
										<strong>{ __( 'Version differs from Blueprint recommendation' ) }</strong>
										<br />
										{ __( 'This Blueprint recommends:' ) }
										<ul className="my-2 pl-4">
											{ showPhpVersionWarning && (
												<li>
													{ sprintf(
														/* translators: %1$s: recommended PHP version, %2$s: default PHP version */
														__( 'PHP %s (selected is %s)' ),
														blueprintPreferredVersions?.php as string,
														phpVersion
													) }
												</li>
											) }
											{ showWpVersionWarning && (
												<li>
													{ sprintf(
														/* translators: %1$s: recommended WordPress version, %2$s: default WordPress version */
														__( 'WordPress %s (selected is %s)' ),
														blueprintPreferredVersions?.wp as string,
														wpVersion
													) }
												</li>
											) }
										</ul>
										{ __( 'Using different versions may cause compatibility issues.' ) }
									</Notice>
								) }

								<div className="flex items-center gap-2 mt-4">
									<input
										type="checkbox"
										id="use-custom-domain"
										checked={ useCustomDomain }
										disabled={ blueprintRequiresCustomDomain }
										onChange={ ( e ) => setUseCustomDomain( e.target.checked ) }
									/>
									<label htmlFor="use-custom-domain">{ __( 'Use custom domain' ) }</label>
								</div>

								{ blueprintRequiresCustomDomain && (
									<Notice status="warning" isDismissible={ false } className="mt-2">
										{ __( 'WordPress multisite requires a custom domain.' ) }
									</Notice>
								) }

								<div className="text-frame-text-secondary text-xs mt-2">
									{ __( 'Your system password will be required to set up the domain.' ) }
								</div>

								{ useCustomDomain && (
									<>
										<div className="flex flex-col gap-2 mt-4">
											<label htmlFor="custom-domain" className="font-semibold">
												{ __( 'Domain name' ) }
											</label>
											<TextControlComponent
												id="custom-domain"
												value={ customDomain !== null ? customDomain : generatedDomainName }
												onChange={ handleCustomDomainChange }
											/>
											{ customDomainError && <SiteFormError error={ customDomainError } /> }
										</div>

										<div className="flex items-center gap-2 mt-4">
											<input
												type="checkbox"
												id="enable-https"
												checked={ enableHttps }
												onChange={ ( e ) => setEnableHttps( e.target.checked ) }
											/>
											<label htmlFor="enable-https">{ __( 'Enable HTTPS' ) }</label>
										</div>

										{ ! isCertificateTrusted && (
											<div className="text-frame-text-secondary text-xs mt-2">
												{ __(
													'You need to manually add the Studio root certificate authority to your keychain and trust it to enable HTTPS.'
												) }{ ' ' }
												<LearnHowLink docsLinksKey="docsSslInStudio" />
											</div>
										) }
									</>
								) }
							</div>
						</div>
					</>
				) }
			</div>
		</form>
	);
};
