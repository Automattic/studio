import { Icon, SelectControl, Notice } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf, _n } from '@wordpress/i18n';
import { tip, cautionFilled, chevronRight, chevronDown, chevronLeft } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useState, useEffect, useCallback, useMemo, useRef, RefObject } from 'react';
import { generateCustomDomainFromSiteName, getDomainNameValidationError } from 'common/lib/domains';
import Button from 'src/components/button';
import FolderIcon from 'src/components/folder-icon';
import { LearnMoreLink, LearnHowLink } from 'src/components/learn-more';
import TextControlComponent from 'src/components/text-control';
import { WPVersionSelector } from 'src/components/wp-version-selector';
import { cx } from 'src/lib/cx';
import { AllowedPHPVersion } from 'src/lib/wordpress-provider/constants';
import { useRootSelector } from 'src/stores';
import { useCheckCertificateTrustQuery } from 'src/stores/certificate-trust-api';
import {
	selectDefaultWordPressVersion,
	selectAllowedPhpVersions,
} from 'src/stores/provider-constants-slice';
import type { CreateSiteFormValues, PathValidationResult } from 'src/hooks/use-add-site';

export interface CreateSiteFormProps {
	/** Initial values and async updates (syncs before user interaction) */
	defaultValues?: {
		siteName?: string;
		sitePath?: string;
		phpVersion?: AllowedPHPVersion;
		wpVersion?: string;
	};
	/** Opens folder picker to select site path */
	onSelectPath?: ( currentPath: string ) => Promise< PathValidationResult | null >;
	/** Generates proposed path when site name changes */
	onSiteNameChange?: ( name: string ) => Promise< PathValidationResult >;
	/** Existing domain names for validation */
	existingDomainNames?: string[];
	/** Blueprint preferred versions for warning display */
	blueprintPreferredVersions?: { php?: string; wp?: string };
	/** Called when form is submitted */
	onSubmit: ( values: CreateSiteFormValues ) => void;
	/** Called when form validity changes */
	onValidityChange?: ( isValid: boolean ) => void;
	/** Ref to form element for programmatic submission */
	formRef?: RefObject< HTMLFormElement >;
}

interface FormPathInputComponentProps {
	value: string;
	onClick: () => void;
	error?: string;
	doesPathContainWordPress: boolean;
	id?: string;
}

interface SiteFormErrorProps {
	error?: string;
	tipMessage?: string;
	className?: string;
}

const SiteFormError = ( { error, tipMessage = '', className = '' }: SiteFormErrorProps ) => {
	return (
		( error || tipMessage ) && (
			<div
				id={ error ? 'error-message' : 'tip-message' }
				role="alert"
				aria-atomic="true"
				className={ cx(
					'flex items-start gap-1 text-xs',
					error ? 'text-red-500' : 'text-a8c-gray-50',
					className
				) }
			>
				<Icon
					className={ cx( 'shrink-0 basis-4', error ? 'fill-red-500' : 'fill-a8c-gray-50' ) }
					icon={ error ? cautionFilled : tip }
					width={ 16 }
					height={ 16 }
				/>
				<p>{ error ? error : __( tipMessage ) }</p>
			</div>
		)
	);
};

function FormPathInputComponent( {
	value,
	onClick,
	error,
	doesPathContainWordPress,
	id,
}: FormPathInputComponentProps ) {
	const { __ } = useI18n();
	return (
		<div className="flex flex-col gap-2">
			<button
				aria-invalid={ !! error }
				/**
				 * The below `aria-describedby` presumes the error message always
				 * relates to the local path input, which is true currently as it is the
				 * only data validation in place. If we ever introduce additional data
				 * validation we need to expand the robustness of this
				 * `aria-describedby` attribute so that it only targets relevant error
				 * messages.
				 */
				aria-describedby={ error ? 'site-path-error' : undefined }
				type="button"
				aria-label={ `${ value }, ${ __( 'Select different local path' ) }` }
				className={ cx(
					'flex flex-row items-stretch rounded-sm border border-[#949494] focus:border-a8c-blue-50 focus:shadow-[0_0_0_0.5px_black] focus:shadow-a8c-blue-50 outline-none transition-shadow transition-linear duration-100 [&_.local-path-icon]:focus:border-l-a8c-blue-50 [&:disabled]:cursor-not-allowed',
					error && 'border-red-500 [&_.local-path-icon]:border-l-red-500'
				) }
				data-testid="select-path-button"
				onClick={ onClick }
				id={ id }
			>
				<div
					aria-hidden="true"
					tabIndex={ -1 }
					className="w-full text-left pl-3 py-3 min-h-10"
					onChange={ () => {} }
				>
					{ value }
				</div>
				<div
					aria-hidden="true"
					className="local-path-icon flex items-center py-[9px] px-2.5 self-center"
				>
					<FolderIcon className="text-[#3C434A]" />
				</div>
			</button>
			<SiteFormError
				error={ error }
				tipMessage={
					doesPathContainWordPress
						? __( 'The existing WordPress site at this path will be added.' )
						: ''
				}
			/>
			<input type="hidden" data-testid="local-path-input" value={ value } />
		</div>
	);
}

export const CreateSiteForm = ( {
	defaultValues = {},
	onSelectPath,
	onSiteNameChange,
	existingDomainNames = [],
	blueprintPreferredVersions,
	onSubmit,
	onValidityChange,
	formRef,
}: CreateSiteFormProps ) => {
	const { __, isRTL } = useI18n();
	const { data: isCertificateTrusted } = useCheckCertificateTrustQuery();
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );
	const allowedPhpVersions = useRootSelector( selectAllowedPhpVersions );

	const [ siteName, setSiteName ] = useState( defaultValues.siteName ?? '' );
	const [ sitePath, setSitePath ] = useState( defaultValues.sitePath ?? '' );
	const [ phpVersion, setPhpVersion ] = useState< AllowedPHPVersion >(
		defaultValues.phpVersion ?? ( allowedPhpVersions[ 0 ] as AllowedPHPVersion ) ?? '8.2'
	);
	const [ wpVersion, setWpVersion ] = useState(
		defaultValues.wpVersion ?? defaultWordPressVersion
	);
	const [ useCustomDomain, setUseCustomDomain ] = useState( false );
	const [ customDomain, setCustomDomain ] = useState< string | null >( null );
	const [ enableHttps, setEnableHttps ] = useState( false );

	const [ pathError, setPathError ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );
	const [ customDomainError, setCustomDomainError ] = useState( '' );
	const [ hasCustomPath, setHasCustomPath ] = useState( false );

	const [ isAdvancedSettingsVisible, setAdvancedSettingsVisible ] = useState( false );

	// Prevent overwriting user input when defaultValues change asynchronously
	const hasUserInteracted = useRef( false );

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
			setPhpVersion( defaultValues.phpVersion );
		}
		if ( defaultValues.wpVersion !== undefined ) {
			setWpVersion( defaultValues.wpVersion );
		}
	}, [ defaultValues.phpVersion, defaultValues.wpVersion ] );

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
				getDomainNameValidationError( useCustomDomain, domainToValidate, existingDomainNames )
			);
		} else {
			setCustomDomainError( '' );
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ useCustomDomain, customDomain, siteName ] );

	// Notify parent of form validity changes
	useEffect( () => {
		if ( ! onValidityChange ) {
			return;
		}

		const hasErrors = !! pathError || ( useCustomDomain && !! customDomainError );
		onValidityChange( ! hasErrors );
	}, [ pathError, customDomainError, useCustomDomain, onValidityChange ] );

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
		[ onSiteNameChange, hasCustomPath ]
	);

	const handleSelectPath = useCallback( async () => {
		if ( ! onSelectPath ) return;

		hasUserInteracted.current = true;
		const result = await onSelectPath( sitePath );
		if ( ! result ) return;

		setHasCustomPath( true );
		setSitePath( result.path );
		if ( result.error ) {
			setPathError( result.error );
		} else {
			setPathError( '' );
		}
		setDoesPathContainWordPress( ! result.isEmpty && result.isWordPress );

		if ( result.name && ! siteName ) {
			setSiteName( result.name );
		}
	}, [ onSelectPath, sitePath, siteName ] );

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
			useCustomDomain,
			customDomain,
			enableHttps,
		} ),
		[ siteName, sitePath, phpVersion, wpVersion, useCustomDomain, customDomain, enableHttps ]
	);

	const handleFormSubmit = useCallback(
		( event: FormEvent ) => {
			event.preventDefault();
			onSubmit( formValues );
		},
		[ onSubmit, formValues ]
	);

	const shouldShowCustomDomainError = useCustomDomain && customDomainError;
	const errorCount = [ pathError, shouldShowCustomDomainError ].filter( Boolean ).length;

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

	// Check if current versions differ from blueprint recommendations
	const showBlueprintVersionWarning =
		blueprintPreferredVersions &&
		( ( blueprintPreferredVersions.php && blueprintPreferredVersions.php !== phpVersion ) ||
			( blueprintPreferredVersions.wp && blueprintPreferredVersions.wp !== wpVersion ) );

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
								handleFormSubmit( event as FormEvent );
							}
						} }
						data-testid="site-name-input"
					/>
				</label>

				{ showAdvancedSettings && (
					<>
						<div className="flex flex-row items-center mb-1">
							<Button
								className="pl-0"
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
						</div>
						<div
							className={ cx(
								'transition-all duration-500 ease-in-out overflow-hidden flex flex-col gap-2 interpolate-size-allow-keywords',
								isAdvancedSettingsVisible ? 'h-auto opacity-100' : 'h-0 opacity-0'
							) }
						>
							<div className={ cx( 'flex flex-col gap-1.5 leading-4 py-4' ) }>
								<label className="font-semibold" htmlFor="local-path">
									{ __( 'Local path' ) }
								</label>
								<span className="text-a8c-gray-50 text-xs">
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
									doesPathContainWordPress={ doesPathContainWordPress }
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
										<SelectControl
											id="php-version-select"
											value={ phpVersion }
											options={ allowedPhpVersions.map( ( version ) => ( {
												label: version,
												value: version,
											} ) ) }
											onChange={ ( value: string ) => setPhpVersion( value as AllowedPHPVersion ) }
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
									</div>

									<WPVersionSelector
										selectedValue={ wpVersion }
										onChange={ setWpVersion }
										fallbackOptions={ [
											{ label: __( 'Latest' ), value: defaultWordPressVersion },
										] }
										offlineMessage={ __(
											'You are currently offline so your site will be created with the latest version. Selecting a different WordPress version requires an internet connection.'
										) }
									/>
								</div>

								{ showBlueprintVersionWarning && (
									<Notice status="warning" isDismissible={ false } className="mt-4">
										<strong>{ __( 'Version differs from Blueprint recommendation' ) }</strong>
										<br />
										{ __( 'This Blueprint recommends:' ) }
										<ul style={ { marginTop: '8px', marginBottom: '4px', paddingLeft: '20px' } }>
											{ blueprintPreferredVersions.php &&
												blueprintPreferredVersions.php !== phpVersion && (
													<li>
														{ sprintf(
															/* translators: %1$s: recommended PHP version, %2$s: currently selected PHP version */
															__( 'PHP %s (currently %s)' ),
															blueprintPreferredVersions.php,
															phpVersion
														) }
													</li>
												) }
											{ blueprintPreferredVersions.wp &&
												blueprintPreferredVersions.wp !== wpVersion && (
													<li>
														{ sprintf(
															/* translators: %1$s: recommended WordPress version, %2$s: currently selected WordPress version */
															__( 'WordPress %s (currently %s)' ),
															blueprintPreferredVersions.wp,
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
										onChange={ ( e ) => setUseCustomDomain( e.target.checked ) }
									/>
									<label htmlFor="use-custom-domain">{ __( 'Use custom domain' ) }</label>
								</div>

								<div className="text-a8c-gray-50 text-xs mt-2">
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
											<div className="text-a8c-gray-50 text-xs mt-2">
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
