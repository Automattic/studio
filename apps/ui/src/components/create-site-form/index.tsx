import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { generatePassword } from '@studio/common/lib/passwords';
import { RecommendedPHPVersion, SupportedPHPVersions } from '@studio/common/types/php-versions';
import { BaseControl, CheckboxControl, TextControl } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronRight } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LearnHowLink, LearnMoreLink } from '@/components/learn-more';
import {
	adminEmailField,
	adminPasswordField,
	adminUsernameField,
	customDomainField,
	phpVersionField,
	siteNameField,
	customDomainToggleField,
	wpVersionField,
} from '@/components/site-fields';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import styles from './style.module.css';
import type { WpEnvFolderInfo } from '@/data/core';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type {
	DataFormControlProps,
	Field,
	FieldValidity,
	Form,
	FormField,
	FormValidity,
} from '@wordpress/dataviews';
import type { FormEvent } from 'react';

export interface CreateSiteFormValues {
	name: string;
	path: string;
	phpVersion: SupportedPHPVersion;
	// Omitted for wp-env projects: the project file defines the WordPress
	// version and the CLI refuses a conflicting --wp.
	wpVersion?: string;
	customDomain?: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

interface CreateSiteFormProps {
	/** Applied once when first defined — user edits win after. */
	initialValues?: Partial< CreateSiteFormValues >;
	existingDomainNames: string[];
	onSubmit: ( values: CreateSiteFormValues ) => void;
	onCancel: () => void;
	isSubmitting?: boolean;
	submitError?: string;
	submitLabel?: string;
}

interface FormData {
	name: string;
	path: string;
	// Stops the name→path auto-gen from overriding a manually picked folder.
	hasCustomPath: boolean;
	pathError: string;
	// Suppresses the path field's required check during the auto-gen async
	// window so a seeded name doesn't flash "1 error found" on the Advanced
	// toggle before `generateProposedPath` resolves.
	isPathPending: boolean;
	// Set when the selected path holds a .wp-env.json project.
	wpEnv?: WpEnvFolderInfo;
	phpVersion: SupportedPHPVersion;
	wpVersion: string;
	useCustomDomain: boolean;
	customDomain: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

function hasAnyValue( values: Partial< CreateSiteFormValues > ): boolean {
	return Object.values( values ).some( ( value ) => value !== undefined && value !== '' );
}

// The project's PHP version is applied as a suggestion; the select stays editable.
function wpEnvFormUpdates( wpEnv: WpEnvFolderInfo | undefined ): Partial< FormData > {
	const projectPhpVersion = SupportedPHPVersions.find( ( v ) => v === wpEnv?.phpVersion );
	return { wpEnv, ...( projectPhpVersion ? { phpVersion: projectPhpVersion } : {} ) };
}

// Only fields the caller actually provided overwrite prev — user edits to
// everything else survive an async initial-value arrival.
function applyInitialValues( prev: FormData, values: Partial< CreateSiteFormValues > ): FormData {
	const next: FormData = { ...prev };
	if ( values.name !== undefined && ! prev.name ) next.name = values.name;
	if ( values.phpVersion !== undefined ) next.phpVersion = values.phpVersion;
	if ( values.wpVersion !== undefined ) next.wpVersion = values.wpVersion;
	if ( values.adminUsername !== undefined ) next.adminUsername = values.adminUsername;
	if ( values.adminPassword !== undefined ) next.adminPassword = values.adminPassword;
	if ( values.adminEmail !== undefined ) next.adminEmail = values.adminEmail;
	if ( values.customDomain ) {
		next.useCustomDomain = true;
		next.customDomain = values.customDomain;
	}
	if ( values.enableHttps !== undefined ) next.enableHttps = values.enableHttps;
	return next;
}

// Called from the form (not `PathField`) so it runs even when Advanced is
// collapsed — otherwise `data.path` would stay empty on first load and the
// Advanced toggle would falsely show "1 error found".
function usePathAutoGenerate( data: FormData, onChange: ( update: Partial< FormData > ) => void ) {
	const { data: sites } = useSites();
	const { generateProposedPath } = usePathValidator( sites );

	const onChangeRef = useRef( onChange );
	useEffect( () => {
		onChangeRef.current = onChange;
	}, [ onChange ] );

	const pendingNameRef = useRef< string | null >( null );
	useEffect( () => {
		if ( data.hasCustomPath ) return;
		const trimmed = data.name.trim();
		if ( ! trimmed ) {
			if ( data.path || data.pathError || data.isPathPending ) {
				onChangeRef.current( { path: '', pathError: '', isPathPending: false } );
			}
			return;
		}
		pendingNameRef.current = trimmed;
		if ( ! data.isPathPending ) {
			onChangeRef.current( { isPathPending: true } );
		}
		let cancelled = false;
		void ( async () => {
			const result = await generateProposedPath( trimmed );
			if ( cancelled || pendingNameRef.current !== trimmed ) return;
			onChangeRef.current( {
				path: result.path,
				pathError: result.error ?? '',
				isPathPending: false,
				...wpEnvFormUpdates( result.wpEnv ),
			} );
		} )();
		return () => {
			cancelled = true;
		};
		// `data.isPathPending` intentionally omitted — the effect writes it,
		// so including it would re-trigger a redundant generate each cycle.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ data.name, data.hasCustomPath, data.path, data.pathError, generateProposedPath ] );
}

// On the desktop this is a button that opens the native folder dialog (the
// value is set by the name→path auto-gen or the dialog, never typed) — which
// also sidesteps the browser's refusal to expose `validationMessage` on
// readonly inputs. In the browser (`studio ui` / hosted) there's no native
// picker, so it falls back to an editable text field: the path is still
// prefilled from the site name, and the server validates the final path on
// create.
function PathField( {
	data: item,
	field,
	hideLabelFromVision,
	onChange,
	validity,
}: DataFormControlProps< FormData > ) {
	const connector = useConnector();
	const { data: sites } = useSites();
	const { selectPath } = usePathValidator( sites );

	const handleSelect = useCallback( async () => {
		const result = await selectPath( item.hasCustomPath ? item.path : '' );
		if ( ! result ) return;
		onChange( {
			path: result.path,
			hasCustomPath: true,
			pathError: result.error ?? '',
			...wpEnvFormUpdates( result.wpEnv ),
			...( ! item.name && result.name ? { name: result.name } : {} ),
		} );
	}, [ item.hasCustomPath, item.name, item.path, onChange, selectPath ] );

	const errorMessage = validity?.custom?.message;
	const help = errorMessage ? (
		<span className={ styles.pathErrorHelp }>{ errorMessage }</span>
	) : item.wpEnv ? (
		__(
			'This folder contains a wp-env project. The WordPress version, plugins, and themes come from its .wp-env.json file.'
		)
	) : (
		<>
			{ __( 'Select an empty directory or a directory with an existing WordPress site.' ) }{ ' ' }
			<LearnMoreLink docsLinksKey="docsSites" />
		</>
	);

	// No native folder picker in the browser — edit the path as text. It's
	// prefilled from the site name; the server validates it on create. The
	// typed folder is inspected on blur so wp-env projects are still detected.
	if ( ! connector.capabilities.nativeFolderPicker ) {
		return (
			<TextControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ field.label }
				hideLabelFromVision={ hideLabelFromVision }
				value={ item.path }
				onChange={ ( value ) => onChange( { path: value, hasCustomPath: true, pathError: '' } ) }
				onBlur={ async () => {
					if ( ! item.path || ! connector.inspectSiteFolder ) return;
					const info = await connector.inspectSiteFolder( item.path ).catch( () => undefined );
					if ( info ) onChange( wpEnvFormUpdates( info.wpEnv ) );
				} }
				help={ help }
			/>
		);
	}

	const triggerLabel = item.path
		? sprintf(
				// translators: %s is the currently selected folder path.
				__( '%s, select a different folder' ),
				item.path
		  )
		: __( 'Select a folder' );

	return (
		<BaseControl
			__nextHasNoMarginBottom
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			help={ help }
		>
			<button
				type="button"
				onClick={ handleSelect }
				aria-label={ triggerLabel }
				aria-invalid={ !! errorMessage || undefined }
				className={ `${ styles.pathTrigger } ${ errorMessage ? styles.pathTriggerError : '' }` }
			>
				<span
					className={ `${ styles.pathValue } ${ item.path ? '' : styles.pathValuePlaceholder }` }
					aria-hidden="true"
				>
					{ item.path || __( 'Choose a folder…' ) }
				</span>
				<span className={ styles.pathTriggerAction } aria-hidden="true">
					{ __( 'Choose\u2026' ) }
				</span>
			</button>
		</BaseControl>
	);
}

// Read-only replacement for the WordPress version field on wp-env projects:
// the project file owns the version.
function WpEnvWpVersionField( {
	data: item,
	field,
	hideLabelFromVision,
}: DataFormControlProps< FormData > ) {
	return (
		<TextControl
			__nextHasNoMarginBottom
			__next40pxDefaultSize
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			value={ item.wpEnv?.wpVersion ?? '' }
			onChange={ () => undefined }
			disabled
			help={ __( 'Defined by the .wp-env.json project file.' ) }
		/>
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

function countAdvancedErrors( validity: FormValidity, form: Form ): number {
	const fieldIds: string[] = [];
	const collect = ( field: FormField | string ) => {
		if ( typeof field === 'string' ) {
			fieldIds.push( field );
			return;
		}
		if ( field.children ) {
			field.children.forEach( collect );
		} else {
			fieldIds.push( field.id );
		}
	};
	form.fields?.forEach( collect );
	return fieldIds.reduce( ( total, id ) => {
		const fieldValidity: FieldValidity | undefined = validity?.[ id ];
		if ( ! fieldValidity ) return total;
		const hasInvalid = Object.values( fieldValidity ).some(
			( rule ) => rule && typeof rule === 'object' && 'type' in rule && rule.type === 'invalid'
		);
		return hasInvalid ? total + 1 : total;
	}, 0 );
}

export function CreateSiteForm( {
	initialValues,
	existingDomainNames,
	onSubmit,
	onCancel,
	isSubmitting,
	submitError,
	submitLabel,
}: CreateSiteFormProps ) {
	const [ data, setData ] = useState< FormData >( () => {
		const base: FormData = {
			name: '',
			path: '',
			hasCustomPath: false,
			pathError: '',
			isPathPending: false,
			phpVersion: RecommendedPHPVersion,
			wpVersion: DEFAULT_WORDPRESS_VERSION,
			useCustomDomain: false,
			customDomain: '',
			enableHttps: false,
			adminUsername: 'admin',
			adminPassword: generatePassword(),
			adminEmail: 'admin@localhost.com',
		};
		if ( ! initialValues ) return base;
		const seeded = applyInitialValues( base, initialValues );
		if ( seeded.name.trim() && ! seeded.path ) seeded.isPathPending = true;
		return seeded;
	} );

	// Handles the async seed case (e.g. `useProposedSiteName` resolving after
	// mount) without clobbering user edits on subsequent renders.
	const hasAppliedInitialValues = useRef( initialValues ? hasAnyValue( initialValues ) : false );
	useEffect( () => {
		if ( hasAppliedInitialValues.current || ! initialValues ) return;
		if ( ! hasAnyValue( initialValues ) ) return;
		hasAppliedInitialValues.current = true;
		setData( ( prev ) => {
			const next = applyInitialValues( prev, initialValues );
			if ( next.name.trim() && ! next.path ) next.isPathPending = true;
			return next;
		} );
	}, [ initialValues ] );

	const fields = useMemo< Field< FormData >[] >(
		() => [
			siteNameField< FormData >(),
			{
				id: 'path',
				label: __( 'Local path' ),
				Edit: PathField,
				// Required check lives inside `custom` so it can opt out while
				// `isPathPending` is true — see the `FormData` comment above.
				isValid: {
					custom: ( item: FormData ) => {
						if ( item.pathError ) return item.pathError;
						if ( item.isPathPending ) return null;
						if ( ! item.path ) return __( 'Local path is required.' );
						return null;
					},
				},
			},
			phpVersionField< FormData >(),
			{
				...wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION ),
				isVisible: ( item: FormData ) => ! item.wpEnv,
			},
			{
				id: 'wpEnvWpVersion',
				label: __( 'WordPress version' ),
				isVisible: ( item: FormData ) => !! item.wpEnv,
				Edit: WpEnvWpVersionField,
			},
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
		],
		[ existingDomainNames ]
	);

	const basicForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [ 'name' ],
		} ),
		[]
	);
	const advancedForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [
				{
					id: 'path',
					layout: { type: 'regular', labelPosition: 'top' },
				},
				{
					id: 'versions',
					layout: { type: 'row' },
					children: [ 'phpVersion', 'wpVersion', 'wpEnvWpVersion' ],
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
	// Covers both sections so the collapsed Advanced toggle still picks up
	// errors from fields that aren't currently mounted.
	const fullForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [ ...basicForm.fields!, ...advancedForm.fields! ],
		} ),
		[ basicForm, advancedForm ]
	);

	const { validity, isValid } = useFormValidity( data, fields, fullForm );
	const [ isAdvancedOpen, setIsAdvancedOpen ] = useState( false );

	const handleChangePartial = useCallback( ( update: Partial< FormData > ) => {
		setData( ( prev ) => ( { ...prev, ...update } ) );
	}, [] );
	usePathAutoGenerate( data, handleChangePartial );

	const handleChange = useCallback( ( update: Record< string, unknown > ) => {
		setData( ( prev ) => {
			const next: FormData = { ...prev, ...( update as Partial< FormData > ) };
			// Seed the custom-domain input on first toggle with a sensible
			// default derived from the site name.
			if ( ! prev.useCustomDomain && next.useCustomDomain && ! next.customDomain ) {
				next.customDomain = generateCustomDomainFromSiteName( next.name );
			}
			return next;
		} );
	}, [] );

	// `isPathPending` is deliberately absent from `isValid` (so the Advanced
	// toggle doesn't flash), so gate submit on it separately.
	const canSubmit = isValid && ! isSubmitting && ! data.isPathPending;

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! canSubmit ) return;
		onSubmit( {
			name: data.name.trim(),
			path: data.path,
			phpVersion: data.phpVersion,
			wpVersion: data.wpEnv ? undefined : data.wpVersion,
			customDomain: data.useCustomDomain
				? data.customDomain || generateCustomDomainFromSiteName( data.name )
				: undefined,
			enableHttps: data.useCustomDomain && data.enableHttps,
			adminUsername: data.adminUsername,
			adminPassword: data.adminPassword,
			adminEmail: data.adminEmail,
		} );
	};

	const advancedErrorCount = countAdvancedErrors( validity, advancedForm );

	return (
		<form className={ styles.form } onSubmit={ handleSubmit }>
			<DataForm< FormData >
				data={ data }
				fields={ fields }
				form={ basicForm }
				onChange={ handleChange }
				validity={ validity }
			/>

			<Button
				type="button"
				variant="unstyled"
				tone="neutral"
				className={ styles.advancedToggle }
				onClick={ () => setIsAdvancedOpen( ( value ) => ! value ) }
				aria-expanded={ isAdvancedOpen }
			>
				<Icon icon={ isAdvancedOpen ? chevronDown : chevronRight } />
				<span>{ __( 'Advanced settings' ) }</span>
				{ ! isAdvancedOpen && advancedErrorCount > 0 && (
					<span className={ styles.advancedErrorCount }>
						{ advancedErrorCount === 1
							? __( '1 error found' )
							: /* translators: %d: number of errors */
							  `${ advancedErrorCount } ${ __( 'errors found' ) }` }
					</span>
				) }
			</Button>

			{ isAdvancedOpen && (
				<DataForm< FormData >
					data={ data }
					fields={ fields }
					form={ advancedForm }
					onChange={ handleChange }
					validity={ validity }
				/>
			) }

			{ submitError && <div className={ styles.submitError }>{ submitError }</div> }

			<div className={ styles.actions }>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					onClick={ onCancel }
					disabled={ isSubmitting }
				>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					type="submit"
					variant="solid"
					tone="brand"
					disabled={ ! canSubmit }
					loading={ isSubmitting }
					loadingAnnouncement={ __( 'Creating site' ) }
					data-testid="create-site-submit"
				>
					{ submitLabel ?? __( 'Create site' ) }
				</Button>
			</div>
		</form>
	);
}
