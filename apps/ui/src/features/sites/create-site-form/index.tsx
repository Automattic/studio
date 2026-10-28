import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import { validateAdminEmail, validateAdminUsername } from '@studio/common/lib/passwords';
import { getFileAccessDescription } from '@studio/common/lib/site-file-access-labels';
import { getLatestVersionLabel } from '@studio/common/lib/wordpress-versions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useWordPressVersions } from '@/data/queries/use-wordpress-versions';
import {
	CertificateTrustNotice,
	getFileAccessOptions,
	getPhpVersionOptions,
	getWpVersionOptions,
	SelectField,
	TextField,
	ToggleField,
	validateAdminPassword,
	validateSiteName,
} from '@/features/sites/site-fields';
import { useOffline } from '@/lib/hooks';
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Field,
	FieldGroup,
	FieldTitle,
} from '@/lib/ui';
import {
	applyFormChange,
	applyInitialValues,
	createDefaultFormData,
	findOfferedWpVersion,
	getSubmittedValues,
	getSuggestedFields,
	INITIAL_VALUE_FIELDS,
	type CreateSiteFormValues,
	type FormData,
} from './form-data';
import { PathField } from './path-field';
import styles from './style.module.css';
import { usePathAutoGenerate } from './use-path-auto-generate';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { FormEvent, ReactElement, ReactNode } from 'react';

export type { CreateSiteFormValues } from './form-data';

export interface CreateSiteFormError {
	title: string;
	message: string;
	details?: string;
}

interface CreateSiteFormProps {
	initialValues?: Partial< CreateSiteFormValues >;
	existingDomainNames: string[];
	onSubmit: ( values: CreateSiteFormValues ) => void;
	onCancel: () => void;
	isSubmitting?: boolean;
	isSubmitDisabled?: boolean;
	requiresCustomDomain?: boolean;
	submitError?: string | CreateSiteFormError;
	submitLabel?: string;
	cancelLabel?: string;
	loadingAnnouncement?: string;
	children?: ReactNode;
	panelFooter?: ReactNode;
	// What the site starts from, shown under its name.
	source?: string;
	sourceIcon?: ReactElement;
	// Whether the folder already holds a WordPress site, which Studio adds as it is.
	onExistingChange?: ( existing: boolean ) => void;
	// Refuses a folder holding a WordPress site, for a site whose files come from elsewhere.
	requiresEmptyPath?: boolean;
	// The fields edited in an earlier opening of the form, restored as edits.
	draft?: Partial< CreateSiteFormValues >;
	onDraftChange?: ( draft: Partial< CreateSiteFormValues > ) => void;
}

export function CreateSiteForm( {
	initialValues,
	existingDomainNames,
	onSubmit,
	onCancel,
	isSubmitting,
	isSubmitDisabled,
	requiresCustomDomain,
	submitError,
	submitLabel,
	cancelLabel,
	loadingAnnouncement,
	children,
	panelFooter,
	source,
	sourceIcon,
	onExistingChange,
	requiresEmptyPath,
	draft,
	onDraftChange,
}: CreateSiteFormProps ) {
	const { capabilities } = useConnector();
	const [ defaults ] = useState( createDefaultFormData );
	const suggestedFieldsRef = useRef( getSuggestedFields( initialValues ?? {} ) );
	const [ data, setData ] = useState< FormData >( () =>
		applyInitialValues(
			applyInitialValues( defaults, initialValues ?? {}, defaults ),
			draft ?? {},
			defaults
		)
	);
	const dirtyFieldsRef = useRef( getSuggestedFields( draft ?? {} ) );
	const [ isNameEdited, setIsNameEdited ] = useState( draft?.name !== undefined );
	const isSubmitQueuedRef = useRef( false );

	useEffect( () => {
		const values = initialValues ?? {};
		const suggestedFields = getSuggestedFields( values );
		const previousSuggestedFields = suggestedFieldsRef.current;
		if ( suggestedFields.size || previousSuggestedFields.size ) {
			setData( ( prev ) =>
				applyInitialValues(
					prev,
					values,
					defaults,
					previousSuggestedFields,
					dirtyFieldsRef.current
				)
			);
		}
		suggestedFieldsRef.current = suggestedFields;
	}, [ defaults, initialValues ] );

	const { data: wpVersions } = useWordPressVersions();
	const isOffline = useOffline();
	// While offline, "latest" is the only version installable without a
	// download, so it's forced.
	useEffect( () => {
		if ( ! isOffline && ! wpVersions?.length ) return;
		setData( ( prev ) => {
			if ( prev.wpVersion === DEFAULT_WORDPRESS_VERSION ) return prev;
			const wpVersion =
				( ! isOffline && findOfferedWpVersion( prev.wpVersion, wpVersions ) ) ||
				DEFAULT_WORDPRESS_VERSION;
			return wpVersion === prev.wpVersion ? prev : { ...prev, wpVersion };
		} );
	}, [ wpVersions, isOffline, data.wpVersion ] );
	const blueprintWpVersion = initialValues?.wpVersion;
	const unavailableWpVersion =
		! isOffline &&
		wpVersions?.length &&
		blueprintWpVersion &&
		blueprintWpVersion !== DEFAULT_WORDPRESS_VERSION &&
		! findOfferedWpVersion( blueprintWpVersion, wpVersions )
			? blueprintWpVersion
			: undefined;
	const wpVersionOptions = getWpVersionOptions( wpVersions, {
		autoUpdateVersion: getLatestVersionLabel( wpVersions ),
		offline: isOffline,
	} );
	const [ isAdvancedOpen, setIsAdvancedOpen ] = useState( false );

	const handleChangePartial = useCallback( ( update: Partial< FormData > ) => {
		setData( ( prev ) => ( { ...prev, ...update } ) );
	}, [] );
	usePathAutoGenerate( data, handleChangePartial, !! isSubmitting, requiresEmptyPath );

	const handleChange = useCallback( ( update: Partial< FormData > ) => {
		isSubmitQueuedRef.current = false;
		for ( const key of Object.keys( update ) ) {
			if ( key === 'useCustomDomain' ) {
				dirtyFieldsRef.current.add( 'customDomain' );
			} else if ( INITIAL_VALUE_FIELDS.includes( key as keyof CreateSiteFormValues ) ) {
				dirtyFieldsRef.current.add( key as keyof CreateSiteFormValues );
			}
		}
		if ( update.name !== undefined ) setIsNameEdited( true );
		setData( ( prev ) => applyFormChange( prev, update ) );
	}, [] );

	const existing = ! requiresEmptyPath && data.isWordPress && !! data.path && ! data.isPathPending;
	// The path's required check opts out while `FormData.isPathPending`.
	const advancedErrors = {
		path:
			data.pathError ||
			( ! data.isPathPending && data.name.trim() && ! data.path
				? __( 'Local path is required.' )
				: '' ),
		adminUsername: validateAdminUsername( data.adminUsername ),
		adminPassword: validateAdminPassword( data.adminPassword ),
		adminEmail: validateAdminEmail( data.adminEmail ),
		customDomain: getDomainNameValidationError(
			data.useCustomDomain,
			data.customDomain || generateCustomDomainFromSiteName( data.name ),
			existingDomainNames
		),
	};
	const nameError = validateSiteName( data.name );
	const advancedErrorCount = Object.values( advancedErrors ).filter( Boolean ).length;
	const showAdvanced =
		isAdvancedOpen ||
		( ! data.isPathPending && !! advancedErrors.path ) ||
		!! advancedErrors.customDomain;
	useEffect( () => onExistingChange?.( existing ), [ existing, onExistingChange ] );
	useEffect( () => {
		const values = { ...getSubmittedValues( data ), name: data.name };
		onDraftChange?.(
			Object.fromEntries(
				[ ...dirtyFieldsRef.current ].map( ( field ) => [ field, values[ field ] ] )
			)
		);
	}, [ data, onDraftChange ] );

	// `isPathPending` is deliberately absent from `canSubmit`: it toggles on
	// every keystroke of the name field while the path auto-gen resolves, and
	// disabling the submit button on it makes the button blink. Submits that
	// land inside that window are queued and fired once the path resolves.
	const canSubmit = ! nameError && ! advancedErrorCount && ! isSubmitting && ! isSubmitDisabled;

	const submitForm = () => {
		onSubmit( getSubmittedValues( data ) );
	};

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! canSubmit ) return;
		if ( data.isPathPending ) {
			isSubmitQueuedRef.current = true;
			return;
		}
		submitForm();
	};

	useEffect( () => {
		if ( data.isPathPending || ! isSubmitQueuedRef.current ) return;
		isSubmitQueuedRef.current = false;
		if ( canSubmit ) submitForm();
	} );

	const wpVersionDescription =
		unavailableWpVersion &&
		sprintf(
			/* translators: %s: WordPress version, e.g. 5.9 */
			__( "This Blueprint asks for WordPress %s, which WordPress Studio can't install." ),
			unavailableWpVersion
		);
	const offlineMessage = __( 'Changing WordPress version requires an internet connection.' );

	return (
		<form className={ styles.form } onSubmit={ handleSubmit }>
			<div className={ styles.panel }>
				<TextField
					label={ __( 'Site name' ) }
					value={ data.name }
					onChange={ ( event ) => handleChange( { name: event.target.value } ) }
					error={ isNameEdited ? nameError : undefined }
					required
					autoFocus
				/>

				{ existing || source ? (
					<Field>
						<FieldTitle>{ __( 'Start with' ) }</FieldTitle>
						<p className={ styles.source }>
							{ existing ? <FileIcon /> : sourceIcon }
							<span>{ existing ? __( 'Existing local WordPress site' ) : source }</span>
						</p>
					</Field>
				) : null }

				{ children }

				<Button
					variant="muted-ghost"
					size="inline"
					className={ styles.advancedToggle }
					onClick={ () => setIsAdvancedOpen( ! showAdvanced ) }
					aria-expanded={ showAdvanced }
				>
					{ showAdvanced ? <ChevronDownIcon /> : <ChevronRightIcon /> }
					<span>{ __( 'Advanced settings' ) }</span>
					{ ! showAdvanced && advancedErrorCount > 0 && (
						<span className={ styles.advancedErrorCount }>
							{ sprintf(
								/* translators: %d: number of validation errors. */
								_n( '%d error found', '%d errors found', advancedErrorCount ),
								advancedErrorCount
							) }
						</span>
					) }
				</Button>

				<div
					className={
						showAdvanced
							? `${ styles.advancedCollapse } ${ styles.advancedCollapseOpen }`
							: styles.advancedCollapse
					}
					inert={ ! showAdvanced || undefined }
				>
					<div className={ styles.advancedCollapseInner }>
						<FieldGroup>
							{ capabilities.siteFolders && (
								<PathField
									data={ data }
									error={ advancedErrors.path }
									requiresEmptyPath={ requiresEmptyPath }
									onChange={ handleChange }
								/>
							) }
							{ capabilities.versionChoice && (
								<>
									{ existing ? null : wpVersionOptions ? (
										<SelectField
											label={ __( 'WordPress version' ) }
											description={ wpVersionDescription }
											value={ data.wpVersion }
											options={ wpVersionOptions }
											disabled={ isOffline }
											disabledReason={ offlineMessage }
											onChange={ ( wpVersion ) => handleChange( { wpVersion } ) }
										/>
									) : (
										<TextField
											label={ __( 'WordPress version' ) }
											orientation="horizontal"
											placeholder={ DEFAULT_WORDPRESS_VERSION }
											value={ data.wpVersion }
											onChange={ ( event ) => handleChange( { wpVersion: event.target.value } ) }
										/>
									) }
									<SelectField
										label={ __( 'PHP version' ) }
										value={ data.phpVersion }
										options={ getPhpVersionOptions() }
										onChange={ ( phpVersion ) =>
											handleChange( { phpVersion: phpVersion as SupportedPHPVersion } )
										}
									/>
								</>
							) }
							{ capabilities.fileAccess && (
								<SelectField
									label={ __( 'File access' ) }
									description={ getFileAccessDescription( data.fileAccess ) }
									value={ data.fileAccess }
									options={ getFileAccessOptions() }
									onChange={ ( fileAccess ) =>
										handleChange( { fileAccess: fileAccess as SiteFileAccess } )
									}
								/>
							) }
							{ ! existing && (
								<>
									{ capabilities.customDomains && (
										<>
											<ToggleField
												label={ __( 'Use custom domain' ) }
												description={
													requiresCustomDomain
														? __( 'This Blueprint requires a custom domain.' )
														: __( 'Your system password will be required to set up the domain.' )
												}
												checked={ data.useCustomDomain }
												disabled={ requiresCustomDomain }
												onChange={ ( useCustomDomain ) => handleChange( { useCustomDomain } ) }
											/>
											{ data.useCustomDomain && (
												<>
													<TextField
														label={ __( 'Domain name' ) }
														value={ data.customDomain }
														error={ advancedErrors.customDomain }
														onChange={ ( event ) =>
															handleChange( { customDomain: event.target.value } )
														}
													/>
													<ToggleField
														label={ __( 'Enable HTTPS' ) }
														description={ <CertificateTrustNotice /> }
														checked={ data.enableHttps }
														onChange={ ( enableHttps ) => handleChange( { enableHttps } ) }
													/>
												</>
											) }
										</>
									) }
									<TextField
										label={ __( 'Admin username' ) }
										value={ data.adminUsername }
										error={ advancedErrors.adminUsername }
										autoComplete="off"
										required
										onChange={ ( event ) => handleChange( { adminUsername: event.target.value } ) }
									/>
									<TextField
										label={ __( 'Admin password' ) }
										type="password"
										value={ data.adminPassword }
										error={ advancedErrors.adminPassword }
										autoComplete="new-password"
										required
										onChange={ ( event ) => handleChange( { adminPassword: event.target.value } ) }
									/>
									<TextField
										label={ __( 'Admin email' ) }
										type="email"
										value={ data.adminEmail }
										error={ advancedErrors.adminEmail }
										required
										onChange={ ( event ) => handleChange( { adminEmail: event.target.value } ) }
									/>
								</>
							) }
						</FieldGroup>
					</div>
				</div>

				{ submitError && (
					<Alert variant="destructive">
						{ typeof submitError === 'string' ? (
							<AlertDescription>{ submitError }</AlertDescription>
						) : (
							<>
								<AlertTitle>{ submitError.title }</AlertTitle>
								<AlertDescription>
									{ submitError.message }
									{ submitError.details && (
										<details className={ styles.submitErrorDetails }>
											<summary>{ __( 'View technical details' ) }</summary>
											<pre>{ submitError.details }</pre>
										</details>
									) }
								</AlertDescription>
							</>
						) }
					</Alert>
				) }

				{ existing || source || ! panelFooter ? null : (
					<div className={ styles.panelFooter }>{ panelFooter }</div>
				) }
			</div>

			<div className={ styles.actions }>
				<Button variant="outline" onClick={ onCancel } disabled={ isSubmitting }>
					{ cancelLabel ?? __( 'Cancel' ) }
				</Button>
				<Button
					type="submit"
					disabled={ ! canSubmit }
					loading={ isSubmitting }
					loadingAnnouncement={ loadingAnnouncement ?? __( 'Creating site' ) }
					data-testid="create-site-submit"
				>
					{ submitLabel ?? __( 'Create site' ) }
				</Button>
			</div>
		</form>
	);
}
