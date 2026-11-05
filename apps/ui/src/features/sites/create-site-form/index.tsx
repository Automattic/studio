import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import { validateAdminEmail, validateAdminUsername } from '@studio/common/lib/passwords';
import { getLatestVersionLabel } from '@studio/common/lib/wordpress-versions';
import { __, sprintf } from '@wordpress/i18n';
import { ChevronDownIcon, FileIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
	FieldError,
	FieldGroup,
	FieldTitle,
	IconButton,
	Popover,
} from '@/lib/ui';
import { getFolderNameError, splitFolderPath } from './folder-path';
import {
	applyFormChange,
	applyInitialValues,
	createDefaultFormData,
	findOfferedWpVersion,
	getSubmittedValues,
	getSuggestedFields,
	INITIAL_VALUE_FIELDS,
	type CreateSiteFormDraft,
	type CreateSiteFormValues,
	type FormData,
} from './form-data';
import { PathField } from './path-field';
import { SettingsSection } from './settings-section';
import styles from './style.module.css';
import { usePathAutoGenerate } from './use-path-auto-generate';
import type { SelectedSiteFolder } from '@/data/core';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { FormEvent, ReactElement, ReactNode } from 'react';

export type { CreateSiteFormDraft, CreateSiteFormValues } from './form-data';

export interface CreateSiteFormError {
	title: string;
	message: string;
	details?: string;
}

interface CreateSiteFormProps {
	selectedFolder?: SelectedSiteFolder;
	initialValues?: Partial< CreateSiteFormValues >;
	existingDomainNames: string[];
	onSubmit: ( values: CreateSiteFormValues ) => void;
	isSubmitting?: boolean;
	isSubmitDisabled?: boolean;
	requiresCustomDomain?: boolean;
	submitError?: string | CreateSiteFormError;
	children?: ReactNode;
	typeControl?: ReactNode;
	sourceControl?: ReactNode;
	sourceDetails?: ReactNode;
	onChangeSource?: () => void;
	sourceActionLabel?: string;
	actionsContainer?: HTMLElement | null;
	// What the site starts from, shown under its name.
	source?: string;
	sourceIcon?: ReactElement;
	// Whether the folder already holds a WordPress site, which Studio adds as it is.
	onExistingChange?: ( existing: boolean ) => void;
	// Refuses a folder holding a WordPress site, for a site whose files come from elsewhere.
	requiresEmptyPath?: boolean;
	requiresExistingPath?: boolean;
	resetPathKey?: number;
	folderDescription?: string;
	onFolderChange?: ( folder: SelectedSiteFolder ) => void;
	// The fields edited in an earlier opening of the form, restored as edits.
	draft?: CreateSiteFormDraft;
	onDraftChange?: ( draft: CreateSiteFormDraft ) => void;
}

export function CreateSiteForm( {
	selectedFolder,
	initialValues,
	existingDomainNames,
	onSubmit,
	isSubmitting,
	isSubmitDisabled,
	requiresCustomDomain,
	submitError,
	children,
	typeControl,
	sourceControl,
	sourceDetails,
	onChangeSource,
	sourceActionLabel,
	actionsContainer,
	source,
	sourceIcon,
	onExistingChange,
	requiresEmptyPath,
	requiresExistingPath,
	resetPathKey,
	folderDescription,
	onFolderChange,
	draft,
	onDraftChange,
}: CreateSiteFormProps ) {
	const formId = useId();
	const advancedId = useId();
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
	const [ isNameFocused, setIsNameFocused ] = useState( false );
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
	const [ advanced, setAdvanced ] = useState( { open: false, attention: '', focusOnOpen: false } );

	const handleChangePartial = useCallback( ( update: Partial< FormData > ) => {
		setData( ( prev ) => ( { ...prev, ...update } ) );
	}, [] );
	usePathAutoGenerate(
		data,
		handleChangePartial,
		!! isSubmitting,
		requiresEmptyPath,
		requiresExistingPath
	);
	const previousResetKey = useRef( resetPathKey );
	useEffect( () => {
		if ( previousResetKey.current === resetPathKey ) return;
		previousResetKey.current = resetPathKey;
		dirtyFieldsRef.current.delete( 'path' );
		isSubmitQueuedRef.current = false;
		handleChangePartial( {
			path: '',
			hasCustomPath: false,
			matchSiteName: false,
			pathError: '',
			isWordPress: false,
			isPathPending: true,
		} );
	}, [ resetPathKey, handleChangePartial ] );

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

	useEffect( () => {
		if ( ! selectedFolder ) return;
		handleChange( {
			path: selectedFolder.path,
			hasCustomPath: true,
			matchSiteName: false,
			pathError: '',
			isWordPress: selectedFolder.isWordPress,
			isPathPending: false,
			...( selectedFolder.name && ! dirtyFieldsRef.current.has( 'name' )
				? { name: selectedFolder.name }
				: {} ),
		} );
	}, [ selectedFolder, handleChange ] );

	const existing = ! requiresEmptyPath && data.isWordPress && !! data.path && ! data.isPathPending;
	const pathError =
		( requiresEmptyPath && data.isWordPress
			? __(
					'Choose an empty folder to use a source. The selected folder already contains a WordPress site.'
			  )
			: data.pathError ) ||
		( ! data.isPathPending &&
		( data.hasCustomPath || data.name.trim() ) &&
		( ! data.matchSiteName || data.name.trim() )
			? getFolderNameError( splitFolderPath( data.path ).name )
			: '' );
	const advancedErrors = {
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
	const errorCount = Object.values( advancedErrors ).filter( Boolean ).length;
	const advancedAttention = [
		requiresCustomDomain ? 'domain-required' : '',
		...Object.values( advancedErrors ),
	]
		.filter( Boolean )
		.join( '|' );
	if ( advancedAttention !== advanced.attention ) {
		setAdvanced( {
			open: advanced.open || !! advancedAttention,
			attention: advancedAttention,
			focusOnOpen: false,
		} );
	}
	const showAdvanced =
		! isSubmitting &&
		( advanced.open || ( advancedAttention !== advanced.attention && !! advancedAttention ) );
	useEffect( () => onExistingChange?.( existing ), [ existing, onExistingChange ] );
	const lastFolderReset = useRef( resetPathKey );
	useEffect( () => {
		if ( lastFolderReset.current !== resetPathKey ) {
			lastFolderReset.current = resetPathKey;
			return;
		}
		if ( existing && ! pathError )
			onFolderChange?.( {
				path: data.path,
				name: splitFolderPath( data.path ).name,
				isEmpty: false,
				isWordPress: true,
			} );
	}, [ existing, pathError, data.path, onFolderChange, resetPathKey ] );
	useEffect( () => {
		const values = { ...getSubmittedValues( data ), name: data.name };
		onDraftChange?.( {
			...Object.fromEntries(
				[ ...dirtyFieldsRef.current ].map( ( field ) => [ field, values[ field ] ] )
			),
			...( dirtyFieldsRef.current.has( 'path' ) ? { isWordPress: data.isWordPress } : {} ),
			...( dirtyFieldsRef.current.has( 'path' ) && data.matchSiteName
				? { matchSiteName: true }
				: {} ),
		} );
	}, [ data, onDraftChange ] );

	// `isPathPending` is deliberately absent from `canSubmit`: it toggles on
	// every keystroke of the name field while the path auto-gen resolves, and
	// disabling the submit button on it makes the button blink. Submits that
	// land inside that window are queued and fired once the path resolves.
	const canSubmit =
		! nameError && ! pathError && ! errorCount && ! isSubmitting && ! isSubmitDisabled;

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
	const advancedLabel = __( 'Advanced' );
	const advancedSettings = (
		<Popover.Root
			open={ showAdvanced }
			onOpenChange={ ( open ) =>
				setAdvanced( ( previous ) => ( { ...previous, open, focusOnOpen: true } ) )
			}
		>
			<div className={ styles.advanced }>
				<Popover.Trigger
					render={
						<Button
							variant="ghost"
							className={ styles.advancedTrigger }
							aria-describedby={
								! showAdvanced && errorCount ? `${ advancedId }-error` : undefined
							}
							disabled={ isSubmitting }
						/>
					}
				>
					{ advancedLabel }
					<ChevronDownIcon aria-hidden="true" />
				</Popover.Trigger>
			</div>
			<Popover.Popup
				className={ styles.advancedPopup }
				side="bottom"
				align="start"
				keepMounted
				initialFocus={ advanced.focusOnOpen ? undefined : false }
			>
				<div className={ styles.popupHeading }>
					<Popover.Title>{ advancedLabel }</Popover.Title>
					<IconButton
						variant="outline"
						icon={ <XIcon /> }
						label={ __( 'Close Advanced' ) }
						size="icon-xs"
						tooltip={ false }
						onClick={ () => setAdvanced( ( previous ) => ( { ...previous, open: false } ) ) }
					/>
				</div>
				<FieldGroup className={ styles.advancedFields } inert={ isSubmitting || undefined }>
					<div className={ styles.paired }>
						{ existing ? null : wpVersionOptions ? (
							<SelectField
								label={ __( 'WordPress version' ) }
								orientation="vertical"
								fullWidth
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
								placeholder={ DEFAULT_WORDPRESS_VERSION }
								value={ data.wpVersion }
								onChange={ ( event ) => handleChange( { wpVersion: event.target.value } ) }
							/>
						) }
						<SelectField
							label={ __( 'PHP version' ) }
							orientation="vertical"
							fullWidth
							value={ data.phpVersion }
							options={ getPhpVersionOptions() }
							onChange={ ( phpVersion ) =>
								handleChange( { phpVersion: phpVersion as SupportedPHPVersion } )
							}
						/>
					</div>
					<div className={ styles.settingsRows }>
						<div className={ styles.fileAccess }>
							<SelectField
								label={ __( 'File access' ) }
								value={ data.fileAccess }
								options={ getFileAccessOptions() }
								onChange={ ( fileAccess ) =>
									handleChange( { fileAccess: fileAccess as SiteFileAccess } )
								}
							/>
						</div>
						{ ! existing && (
							<>
								<SettingsSection
									label={ __( 'Admin account' ) }
									summary={ data.adminUsername }
									error={
										advancedErrors.adminUsername ||
										advancedErrors.adminPassword ||
										advancedErrors.adminEmail
									}
								>
									<FieldGroup className={ styles.popupFields }>
										<div className={ styles.paired }>
											<TextField
												label={ __( 'Admin username' ) }
												value={ data.adminUsername }
												error={ advancedErrors.adminUsername }
												autoComplete="off"
												required
												onChange={ ( event ) =>
													handleChange( { adminUsername: event.target.value } )
												}
											/>
											<TextField
												label={ __( 'Admin password' ) }
												type="password"
												value={ data.adminPassword }
												error={ advancedErrors.adminPassword }
												autoComplete="new-password"
												required
												onChange={ ( event ) =>
													handleChange( { adminPassword: event.target.value } )
												}
											/>
										</div>
										<TextField
											label={ __( 'Admin email' ) }
											type="email"
											value={ data.adminEmail }
											error={ advancedErrors.adminEmail }
											required
											onChange={ ( event ) => handleChange( { adminEmail: event.target.value } ) }
										/>
									</FieldGroup>
								</SettingsSection>
								<SettingsSection
									label={ __( 'Domain' ) }
									summary={
										data.useCustomDomain
											? data.customDomain || generateCustomDomainFromSiteName( data.name )
											: __( 'localhost' )
									}
									error={ advancedErrors.customDomain }
								>
									<FieldGroup className={ styles.popupFields }>
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
									</FieldGroup>
								</SettingsSection>
							</>
						) }
					</div>
				</FieldGroup>
			</Popover.Popup>
		</Popover.Root>
	);
	const actions = (
		<>
			{ advancedSettings }
			<Button
				variant="accent"
				type="submit"
				form={ formId }
				disabled={ ! canSubmit }
				loading={ isSubmitting }
				loadingAnnouncement={ __( 'Adding site' ) }
				data-testid="create-site-submit"
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);

	return (
		<form id={ formId } className={ styles.form } onSubmit={ handleSubmit }>
			<FieldGroup className={ styles.panel }>
				<div className={ styles.identity } data-paired={ !! typeControl || undefined }>
					<TextField
						label={ __( 'Site name' ) }
						value={ data.name }
						onChange={ ( event ) => handleChange( { name: event.target.value } ) }
						onFocus={ () => setIsNameFocused( true ) }
						onBlur={ () => setIsNameFocused( false ) }
						error={ isNameEdited && ! isNameFocused ? nameError : undefined }
						required
						autoFocus
					/>
					{ typeControl }
				</div>

				<PathField
					data={ data }
					error={ pathError }
					requiresEmptyPath={ requiresEmptyPath }
					requiresExistingPath={ requiresExistingPath }
					description={ folderDescription }
					disabled={ isSubmitting }
					onChange={ handleChange }
				/>

				{ sourceControl }

				{ ( existing && ! sourceControl ) || source ? (
					<Field>
						<FieldTitle>{ __( 'Start with' ) }</FieldTitle>
						<div className={ styles.source }>
							{ existing ? <FileIcon /> : sourceIcon }
							<span>{ existing ? __( 'Existing local WordPress site' ) : source }</span>
							{ ! existing && onChangeSource ? (
								<Button
									variant="inline-text"
									size="inline"
									onClick={ onChangeSource }
									disabled={ isSubmitting || isSubmitDisabled }
								>
									{ sourceActionLabel ?? __( 'Change' ) }
								</Button>
							) : null }
						</div>
						{ ! existing ? sourceDetails : null }
					</Field>
				) : null }

				{ children }

				{ ! showAdvanced && errorCount ? (
					<FieldError id={ `${ advancedId }-error` }>
						{ __( 'Review the advanced settings to finish creating your site.' ) }
					</FieldError>
				) : null }

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
			</FieldGroup>

			{ actionsContainer === undefined ? (
				<div className={ styles.actions }>{ actions }</div>
			) : actionsContainer ? (
				createPortal( actions, actionsContainer )
			) : null }
		</form>
	);
}
