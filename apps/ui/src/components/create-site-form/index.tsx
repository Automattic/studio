import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	generatePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { getFileAccessDescription } from '@studio/common/lib/site-file-access-labels';
import { getLatestVersionLabel } from '@studio/common/lib/wordpress-versions';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LearnMoreLink } from '@/components/learn-more';
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
} from '@/components/site-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import { useWordPressVersions } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { FormEvent, ReactElement, ReactNode } from 'react';

export interface CreateSiteFormValues {
	name: string;
	path: string;
	phpVersion: SupportedPHPVersion;
	fileAccess: SiteFileAccess;
	wpVersion: string;
	customDomain?: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

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
}

interface FormData {
	name: string;
	path: string;
	// Stops the name→path auto-gen from overriding a manually picked folder.
	hasCustomPath: boolean;
	pathError: string;
	isWordPress: boolean;
	// Suppresses the path field's required check during the auto-gen async
	// window so a seeded name doesn't flash "1 error found" on the Advanced
	// toggle before `generateProposedPath` resolves.
	isPathPending: boolean;
	phpVersion: SupportedPHPVersion;
	fileAccess: SiteFileAccess;
	wpVersion: string;
	useCustomDomain: boolean;
	customDomain: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

const SIMPLE_FIELDS = [
	'name',
	'phpVersion',
	'fileAccess',
	'wpVersion',
	'enableHttps',
	'adminUsername',
	'adminPassword',
	'adminEmail',
] as const satisfies readonly ( keyof CreateSiteFormValues )[];
const INITIAL_VALUE_FIELDS = [ ...SIMPLE_FIELDS, 'path', 'customDomain' ] as const;
const TYPED_PATH_CHECK_DELAY_MS = 300;

function createDefaultFormData(): FormData {
	return {
		name: '',
		path: '',
		hasCustomPath: false,
		pathError: '',
		isWordPress: false,
		isPathPending: false,
		phpVersion: RecommendedPHPVersion,
		fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
		wpVersion: DEFAULT_WORDPRESS_VERSION,
		useCustomDomain: false,
		customDomain: '',
		enableHttps: false,
		adminUsername: DEFAULT_ADMIN_USERNAME,
		adminPassword: generatePassword(),
		adminEmail: DEFAULT_ADMIN_EMAIL,
	};
}

function getSuggestedFields(
	values: Partial< CreateSiteFormValues >
): Set< keyof CreateSiteFormValues > {
	return new Set(
		( Object.keys( values ) as ( keyof CreateSiteFormValues )[] ).filter(
			( field ) => values[ field ] !== undefined
		)
	);
}

function applyInitialValues(
	prev: FormData,
	values: Partial< CreateSiteFormValues >,
	defaults: FormData,
	previousSuggestedFields: Set< keyof CreateSiteFormValues > = new Set(),
	dirtyFields: Set< keyof CreateSiteFormValues > = new Set()
): FormData {
	const next: FormData = { ...prev };
	const defaultValuesByField: Record< keyof CreateSiteFormValues, Partial< FormData > > = {
		name: { name: defaults.name },
		path: {
			path: defaults.path,
			hasCustomPath: defaults.hasCustomPath,
			pathError: defaults.pathError,
			isWordPress: defaults.isWordPress,
			isPathPending: defaults.isPathPending,
		},
		phpVersion: { phpVersion: defaults.phpVersion },
		fileAccess: { fileAccess: defaults.fileAccess },
		wpVersion: { wpVersion: defaults.wpVersion },
		customDomain: {
			useCustomDomain: defaults.useCustomDomain,
			customDomain: defaults.customDomain,
		},
		enableHttps: { enableHttps: defaults.enableHttps },
		adminUsername: { adminUsername: defaults.adminUsername },
		adminPassword: { adminPassword: defaults.adminPassword },
		adminEmail: { adminEmail: defaults.adminEmail },
	};
	for ( const field of previousSuggestedFields ) {
		if ( values[ field ] !== undefined || dirtyFields.has( field ) ) continue;
		Object.assign( next, defaultValuesByField[ field ] );
	}
	for ( const field of SIMPLE_FIELDS ) {
		if ( values[ field ] !== undefined && ! dirtyFields.has( field ) ) {
			Object.assign( next, { [ field ]: values[ field ] } );
		}
	}
	if ( values.path !== undefined && ! dirtyFields.has( 'path' ) ) {
		next.path = values.path;
		next.hasCustomPath = !! values.path;
		next.pathError = '';
		next.isWordPress = false;
		next.isPathPending = false;
	}
	if ( values.customDomain !== undefined && ! dirtyFields.has( 'customDomain' ) ) {
		next.useCustomDomain = !! values.customDomain;
		next.customDomain = values.customDomain;
	}
	if ( ! next.hasCustomPath && next.name !== prev.name ) {
		next.isPathPending = !! next.name.trim();
		next.pathError = '';
		if ( ! next.name.trim() ) next.path = '';
	}
	return Object.keys( next ).some(
		( key ) => next[ key as keyof FormData ] !== prev[ key as keyof FormData ]
	)
		? next
		: prev;
}

// Called from the form (not `PathField`) so it runs even when Advanced is
// collapsed — otherwise `data.path` would stay empty on first load and the
// Advanced toggle would falsely show "1 error found".
function usePathAutoGenerate(
	data: FormData,
	onChange: ( update: Partial< FormData > ) => void,
	isSubmitting: boolean
) {
	const connector = useConnector();
	const { data: sites } = useSites();
	const { generateProposedPath, selectPath } = usePathValidator( sites );

	const onChangeRef = useRef( onChange );
	useEffect( () => {
		onChangeRef.current = onChange;
	}, [ onChange ] );

	const pendingNameRef = useRef< string | null >( null );
	useEffect( () => {
		if ( isSubmitting ) return;
		if ( data.hasCustomPath ) {
			pendingNameRef.current = null;
			onChangeRef.current( { isPathPending: false } );
			return;
		}
		const trimmed = data.name.trim();
		if ( ! trimmed ) {
			pendingNameRef.current = null;
			onChangeRef.current( { path: '', pathError: '', isPathPending: false } );
			return;
		}
		pendingNameRef.current = trimmed;
		onChangeRef.current( { isPathPending: true } );
		let cancelled = false;
		void ( async () => {
			try {
				const result = await generateProposedPath( trimmed );
				if ( cancelled || pendingNameRef.current !== trimmed ) return;
				onChangeRef.current( {
					path: result.path,
					pathError: result.error ?? '',
					isWordPress: result.isWordPress,
					isPathPending: false,
				} );
			} catch {
				if ( cancelled || pendingNameRef.current !== trimmed ) return;
				onChangeRef.current( {
					path: '',
					pathError: __( 'Unable to suggest a folder for this site name.' ),
					isPathPending: false,
				} );
			}
		} )();
		return () => {
			cancelled = true;
		};
	}, [ data.name, data.hasCustomPath, generateProposedPath, isSubmitting ] );

	// Without a native picker the folder is typed, so it's checked as it's typed.
	const typedPath =
		data.hasCustomPath && ! connector.capabilities.nativeFolderPicker ? data.path.trim() : '';
	useEffect( () => {
		if ( isSubmitting || ! typedPath ) return;
		onChangeRef.current( { isPathPending: true } );
		let cancelled = false;
		const timer = setTimeout( async () => {
			try {
				const result = await selectPath( typedPath );
				if ( cancelled ) return;
				onChangeRef.current( {
					pathError: result?.error ?? '',
					isWordPress: !! result?.isWordPress,
					isPathPending: false,
				} );
			} catch ( error ) {
				if ( cancelled ) return;
				onChangeRef.current( { pathError: getErrorMessage( error ), isPathPending: false } );
			}
		}, TYPED_PATH_CHECK_DELAY_MS );
		return () => {
			cancelled = true;
			clearTimeout( timer );
		};
	}, [ typedPath, selectPath, isSubmitting ] );
}

// On the desktop the path comes from the name→path auto-gen or the native
// folder dialog, never typed. In the browser (`studio ui`) there's no native
// picker, so it is edited as text, still prefilled from the site name.
function PathField( {
	data: item,
	error,
	onChange,
}: {
	data: FormData;
	error: string;
	onChange: ( update: Partial< FormData > ) => void;
} ) {
	const id = useId();
	const connector = useConnector();
	const { data: sites } = useSites();
	const { selectPath } = usePathValidator( sites );
	const isNative = connector.capabilities.nativeFolderPicker;

	const handleSelect = useCallback( async () => {
		const result = await selectPath( item.hasCustomPath ? item.path : '' );
		if ( ! result ) return;
		onChange( {
			path: result.path,
			hasCustomPath: true,
			pathError: result.error ?? '',
			isWordPress: result.isWordPress,
			...( ! item.name && result.name ? { name: result.name } : {} ),
		} );
	}, [ item.hasCustomPath, item.name, item.path, onChange, selectPath ] );

	const help =
		item.path && item.isWordPress ? (
			__( 'The existing WordPress site at this path will be added.' )
		) : (
			<>
				{ __( 'Select an empty directory or a directory with an existing WordPress site.' ) }{ ' ' }
				<LearnMoreLink docsLinksKey="docsSites" />
			</>
		);

	return (
		<Field>
			<FieldLabel htmlFor={ id }>{ __( 'Local path' ) }</FieldLabel>
			<div className={ styles.pathRow }>
				<Input
					id={ id }
					value={ item.path }
					readOnly={ isNative }
					placeholder={ isNative ? __( 'Choose a folder…' ) : undefined }
					aria-invalid={ error ? true : undefined }
					aria-describedby={ `${ id }-description` }
					onChange={ ( event ) =>
						onChange( {
							path: event.target.value,
							hasCustomPath: true,
							pathError: '',
							isWordPress: false,
						} )
					}
				/>
				{ isNative && (
					<Button
						variant="outline"
						onClick={ handleSelect }
						aria-label={
							item.path
								? sprintf(
										// translators: %s is the currently selected folder path.
										__( '%s, select a different folder' ),
										item.path
								  )
								: __( 'Select a folder' )
						}
					>
						{ __( 'Choose…' ) }
					</Button>
				) }
			</div>
			<FieldDescription id={ `${ id }-description` } error={ error }>
				{ help }
			</FieldDescription>
		</Field>
	);
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
}: CreateSiteFormProps ) {
	const [ defaults ] = useState( createDefaultFormData );
	const suggestedFieldsRef = useRef( getSuggestedFields( initialValues ?? {} ) );
	const [ data, setData ] = useState< FormData >( () => {
		if ( ! initialValues ) return defaults;
		return applyInitialValues( defaults, initialValues, defaults );
	} );
	const dirtyFieldsRef = useRef( new Set< keyof CreateSiteFormValues >() );
	const [ isNameEdited, setIsNameEdited ] = useState( false );
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
	// download, so it's forced — same as the legacy version selector.
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
	usePathAutoGenerate( data, handleChangePartial, !! isSubmitting );

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
		setData( ( prev ) => {
			const next: FormData = { ...prev, ...update };
			if ( update.name !== undefined && ! prev.hasCustomPath && next.name !== prev.name ) {
				next.isPathPending = !! next.name.trim();
				next.pathError = '';
				if ( ! next.name.trim() ) next.path = '';
			}
			// Seed the custom-domain input on first toggle with a sensible
			// default derived from the site name.
			if ( ! prev.useCustomDomain && next.useCustomDomain && ! next.customDomain ) {
				next.customDomain = generateCustomDomainFromSiteName( next.name );
			}
			return next;
		} );
	}, [] );

	// The path's required check opts out while `isPathPending` — see the
	// `FormData` comment above.
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
	const existing = data.isWordPress && !! data.path && ! data.isPathPending;
	useEffect( () => onExistingChange?.( existing ), [ existing, onExistingChange ] );

	// `isPathPending` is deliberately absent from `canSubmit`: it toggles on
	// every keystroke of the name field while the path auto-gen resolves, and
	// disabling the submit button on it makes the button blink. Submits that
	// land inside that window are queued and fired once the path resolves.
	const canSubmit = ! nameError && ! advancedErrorCount && ! isSubmitting && ! isSubmitDisabled;

	const submitForm = () => {
		onSubmit( {
			name: data.name.trim(),
			path: data.path,
			phpVersion: data.phpVersion,
			fileAccess: data.fileAccess,
			wpVersion: data.wpVersion,
			customDomain: data.useCustomDomain
				? data.customDomain || generateCustomDomainFromSiteName( data.name )
				: undefined,
			enableHttps: data.useCustomDomain && data.enableHttps,
			adminUsername: data.adminUsername,
			adminPassword: data.adminPassword,
			adminEmail: data.adminEmail,
		} );
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
			__( "This Blueprint asks for WordPress %s, which Studio can't install." ),
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
							<PathField data={ data } error={ advancedErrors.path } onChange={ handleChange } />
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
							<SelectField
								label={ __( 'File access' ) }
								description={ getFileAccessDescription( data.fileAccess ) }
								value={ data.fileAccess }
								options={ getFileAccessOptions() }
								onChange={ ( fileAccess ) =>
									handleChange( { fileAccess: fileAccess as SiteFileAccess } )
								}
							/>
							{ ! existing && (
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

// The list only offers each branch's newest release, so a Blueprint asking for
// "6.5" or "6.5.5" gets 6.5's newest release (the list is newest-first).
function findOfferedWpVersion( version: string, offered: WordPressVersion[] = [] ) {
	const branch = version.split( '.' ).slice( 0, 2 ).join( '.' );
	return (
		offered.find( ( { value } ) => value === version )?.value ??
		offered.find( ( { value } ) => value.startsWith( `${ branch }.` ) )?.value
	);
}
