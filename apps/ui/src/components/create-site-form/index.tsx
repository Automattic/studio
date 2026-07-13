import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { generatePassword } from '@studio/common/lib/passwords';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { BaseControl, CheckboxControl, TextControl } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __, _n, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronLeft, chevronRight } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LearnHowLink, LearnMoreLink } from '@/components/learn-more';
import { OnboardingFooter } from '@/components/onboarding-footer';
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
import { useWordPressVersions } from '@/data/queries/use-wordpress-versions';
import styles from './style.module.css';
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
	wpVersion: string;
	customDomain?: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

interface CreateSiteFormProps {
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
	phpVersion: SupportedPHPVersion;
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
	'wpVersion',
	'enableHttps',
	'adminUsername',
	'adminPassword',
	'adminEmail',
] as const satisfies readonly ( keyof CreateSiteFormValues )[];
const INITIAL_VALUE_FIELDS = [ ...SIMPLE_FIELDS, 'path', 'customDomain' ] as const;

function createDefaultFormData(): FormData {
	return {
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
			isPathPending: defaults.isPathPending,
		},
		phpVersion: { phpVersion: defaults.phpVersion },
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
function usePathAutoGenerate( data: FormData, onChange: ( update: Partial< FormData > ) => void ) {
	const { data: sites } = useSites();
	const { generateProposedPath } = usePathValidator( sites );

	const onChangeRef = useRef( onChange );
	useEffect( () => {
		onChangeRef.current = onChange;
	}, [ onChange ] );

	const pendingNameRef = useRef< string | null >( null );
	useEffect( () => {
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
	}, [ data.name, data.hasCustomPath, generateProposedPath ] );
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
			...( ! item.name && result.name ? { name: result.name } : {} ),
		} );
	}, [ item.hasCustomPath, item.name, item.path, onChange, selectPath ] );

	const errorMessage = item.pathError || validity?.custom?.message;
	const help = errorMessage ? (
		<span className={ styles.pathErrorHelp }>{ errorMessage }</span>
	) : (
		<>
			{ __( 'Select an empty directory or a directory with an existing WordPress site.' ) }{ ' ' }
			<LearnMoreLink docsLinksKey="docsSites" />
		</>
	);

	// No native folder picker in the browser — edit the path as text. It's
	// prefilled from the site name; the server validates it on create.
	if ( ! connector.capabilities.nativeFolderPicker ) {
		return (
			<TextControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ field.label }
				hideLabelFromVision={ hideLabelFromVision }
				value={ item.path }
				onChange={ ( value ) => onChange( { path: value, hasCustomPath: true, pathError: '' } ) }
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
	const formRef = useRef< HTMLFormElement >( null );
	const initialSuggestedFields = getSuggestedFields( initialValues ?? {} );
	const shouldReportSuggestedErrorsRef = useRef( initialSuggestedFields.size > 0 );
	const [ defaults ] = useState( createDefaultFormData );
	const suggestedFieldsRef = useRef( initialSuggestedFields );
	const [ data, setData ] = useState< FormData >( () => {
		if ( ! initialValues ) return defaults;
		return applyInitialValues( defaults, initialValues, defaults );
	} );
	const dirtyFieldsRef = useRef( new Set< keyof CreateSiteFormValues >() );

	useEffect( () => {
		const values = initialValues ?? {};
		const suggestedFields = getSuggestedFields( values );
		const previousSuggestedFields = suggestedFieldsRef.current;
		if ( suggestedFields.size || previousSuggestedFields.size ) {
			if ( suggestedFields.size ) shouldReportSuggestedErrorsRef.current = true;
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
	useEffect( () => {
		if ( ! wpVersions?.length ) return;
		setData( ( prev ) =>
			wpVersions.some( ( version ) => version.value === prev.wpVersion )
				? prev
				: { ...prev, wpVersion: DEFAULT_WORDPRESS_VERSION }
		);
	}, [ wpVersions, data.wpVersion ] );

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
						if ( item.isPathPending || ! item.name.trim() ) return null;
						if ( ! item.path ) return __( 'Local path is required.' );
						return null;
					},
				},
			},
			phpVersionField< FormData >(),
			wpVersionField< FormData >( DEFAULT_WORDPRESS_VERSION, wpVersions ),
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
		[ existingDomainNames, wpVersions ]
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

	// Validated controls hide programmatic errors until they receive an invalid event.
	// Wait for DataForm to apply custom validity, then reveal errors from suggested values.
	useEffect( () => {
		if ( ! shouldReportSuggestedErrorsRef.current ) return;
		const timeout = window.setTimeout( () => {
			shouldReportSuggestedErrorsRef.current = false;
			formRef.current
				?.querySelectorAll< HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement >(
					'input, select, textarea'
				)
				.forEach( ( control ) => {
					if ( ! control.validity.valid ) control.reportValidity();
				} );
		}, 0 );
		return () => window.clearTimeout( timeout );
	}, [ data, initialValues, validity ] );

	const handleChangePartial = useCallback( ( update: Partial< FormData > ) => {
		setData( ( prev ) => ( { ...prev, ...update } ) );
	}, [] );
	usePathAutoGenerate( data, handleChangePartial );

	const handleChange = useCallback( ( update: Record< string, unknown > ) => {
		for ( const key of Object.keys( update ) ) {
			if ( key === 'useCustomDomain' ) {
				dirtyFieldsRef.current.add( 'customDomain' );
			} else if ( INITIAL_VALUE_FIELDS.includes( key as keyof CreateSiteFormValues ) ) {
				dirtyFieldsRef.current.add( key as keyof CreateSiteFormValues );
			}
		}
		setData( ( prev ) => {
			const next: FormData = { ...prev, ...( update as Partial< FormData > ) };
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

	// `isPathPending` is deliberately absent from `isValid` (so the Advanced
	// toggle doesn't flash), so gate submit on it separately.
	const canSubmit = isValid && ! isSubmitting && ! data.isPathPending && ! data.pathError;

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! canSubmit ) return;
		onSubmit( {
			name: data.name.trim(),
			path: data.path,
			phpVersion: data.phpVersion,
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

	const advancedErrorCount = countAdvancedErrors( validity, advancedForm );
	const actions = (
		<>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				onClick={ onCancel }
				disabled={ isSubmitting }
			>
				<Icon icon={ chevronLeft } size={ 16 } />
				<span>{ __( 'Back' ) }</span>
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
		</>
	);

	return (
		<form ref={ formRef } className={ styles.form } onSubmit={ handleSubmit }>
			<div className={ styles.panel }>
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
						isAdvancedOpen
							? `${ styles.advancedCollapse } ${ styles.advancedCollapseOpen }`
							: styles.advancedCollapse
					}
					inert={ ! isAdvancedOpen || undefined }
				>
					<div className={ styles.advancedCollapseInner }>
						<DataForm< FormData >
							data={ data }
							fields={ fields }
							form={ advancedForm }
							onChange={ handleChange }
							validity={ validity }
						/>
					</div>
				</div>

				{ submitError && (
					<div role="alert" className={ styles.submitError }>
						{ submitError }
					</div>
				) }
			</div>

			<OnboardingFooter>{ actions }</OnboardingFooter>
		</form>
	);
}
