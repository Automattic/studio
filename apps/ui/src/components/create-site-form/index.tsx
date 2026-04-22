import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { generatePassword } from '@studio/common/lib/passwords';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import {
	CheckboxControl,
	privateApis as componentsPrivateApis,
	__experimentalInputControlSuffixWrapper as InputControlSuffixWrapper,
} from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
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
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import { unlock } from '@/lock-unlock';
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
	/**
	 * Initial field values applied once when first defined — the form won't
	 * fight user input after that. Lets callers seed a randomly-generated
	 * site name, pre-fill a blueprint's admin credentials / versions, etc.,
	 * without needing a controlled form.
	 */
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
	// True once the user has manually picked a folder via the path picker,
	// so the name→path auto-generation effect stops overriding their choice.
	hasCustomPath: boolean;
	// IPC-derived path validation error (duplicate site, non-empty non-WP dir).
	// Owned by `PathField`, read by the `path` field's `isValid.custom` rule so
	// DataForm surfaces it through its normal validity channel.
	pathError: string;
	// True while the async name→path generation is in flight. Used to suppress
	// the path field's "required" validity during that window so seeding a
	// name via `initialValues` doesn't flash "1 error found" on the Advanced
	// settings toggle between the name landing and `generateProposedPath`
	// resolving one microtask later.
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

// ValidatedInputControl is the same private-API control DataForm's built-in
// `text`/`email`/`password` Edit components use, so wiring the path field
// through it keeps error styling (red ring + icon) consistent with the rest
// of the form.
const { ValidatedInputControl } = unlock( componentsPrivateApis ) as {
	ValidatedInputControl: React.ComponentType< {
		label?: React.ReactNode;
		hideLabelFromVision?: boolean;
		value?: string;
		placeholder?: string;
		readOnly?: boolean;
		required?: boolean;
		onClick?: () => void;
		onChange?: ( value: string | undefined ) => void;
		help?: React.ReactNode;
		suffix?: React.ReactNode;
		customValidity?: { type: 'valid' | 'invalid' | 'validating'; message?: string };
		__next40pxDefaultSize?: boolean;
		className?: string;
	} >;
};

function hasAnyValue( values: Partial< CreateSiteFormValues > ): boolean {
	return Object.values( values ).some( ( value ) => value !== undefined && value !== '' );
}

/**
 * Merges caller-supplied initial values into form state. Only fields the
 * caller actually provided are overwritten — user edits to everything else
 * survive an async initial-value arrival.
 */
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

/**
 * Runs the name→path auto-generation effect on behalf of the form. Called
 * from `CreateSiteForm` so it fires whether the Advanced settings section is
 * open or not — otherwise `data.path` would stay empty on first load and the
 * Advanced toggle would falsely show "1 error found" until the user
 * expanded it and `PathField` mounted.
 */
function usePathAutoGenerate( data: FormData, onChange: ( update: Partial< FormData > ) => void ) {
	const { data: sites } = useSites();
	const { generateProposedPath } = usePathValidator( sites );

	// `onChange` may be recreated per parent render. Ref it so the async
	// effect doesn't re-subscribe every keystroke.
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
		// Mark pending before kicking off the async generate so the path
		// field's validity suppresses its required check during the window.
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
			} );
		} )();
		return () => {
			cancelled = true;
		};
		// `data.isPathPending` is intentionally omitted from deps: this effect
		// writes it (true when starting a generate, false when resolving), and
		// re-running the effect each time that flip lands would kick off a
		// redundant generate on every cycle.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ data.name, data.hasCustomPath, data.path, data.pathError, generateProposedPath ] );
}

function PathField( {
	data: item,
	field,
	hideLabelFromVision,
	onChange,
	validity,
}: DataFormControlProps< FormData > ) {
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

	const errorMessage = validity?.custom?.message;

	return (
		<ValidatedInputControl
			__next40pxDefaultSize
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			value={ item.path }
			placeholder={ __( 'Choose a folder…' ) }
			readOnly
			onClick={ handleSelect }
			className={ styles.pathControl }
			customValidity={ errorMessage ? { type: 'invalid', message: errorMessage } : undefined }
			help={
				<>
					{ __( 'Select an empty directory or a directory with an existing WordPress site.' ) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsSites" />
				</>
			}
			suffix={
				<InputControlSuffixWrapper variant="control">
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						size="small"
						onClick={ handleSelect }
					>
						{ __( 'Choose…' ) }
					</Button>
				</InputControlSuffixWrapper>
			}
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

/**
 * Walks the advanced form config and tallies how many of its leaf fields
 * currently have invalid validity state. Used to surface an error indicator
 * on the Advanced settings toggle when it's collapsed.
 */
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
		// Synchronous seed — callers already holding the full initial snapshot
		// (e.g. values extracted from a blueprint) get them applied before the
		// first render so derived effects like name→path see the seeded name.
		const seeded = applyInitialValues( base, initialValues );
		// If we seeded a name but have no path yet, auto-generation will fire on
		// mount. Flag the gap so the path field's validity doesn't surface a
		// stray "required" error before the first generate resolves.
		if ( seeded.name.trim() && ! seeded.path ) seeded.isPathPending = true;
		return seeded;
	} );

	// Re-apply `initialValues` the first time it resolves with a populated
	// value. Handles the async case (e.g. `useProposedSiteName` returns after
	// mount) without clobbering user edits on subsequent re-renders.
	const hasAppliedInitialValues = useRef( initialValues ? hasAnyValue( initialValues ) : false );
	useEffect( () => {
		if ( hasAppliedInitialValues.current || ! initialValues ) return;
		if ( ! hasAnyValue( initialValues ) ) return;
		hasAppliedInitialValues.current = true;
		setData( ( prev ) => {
			const next = applyInitialValues( prev, initialValues );
			// Same rationale as the synchronous seed above — flag pending so
			// the auto-gen window doesn't flash a required error.
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
				isValid: {
					// `required` is expressed through `custom` so it can opt out
					// while name→path auto-generation is pending — without this,
					// the brief empty-path window after a seeded name would flash
					// "1 error found" on the Advanced settings toggle.
					custom: ( item: FormData ) => {
						if ( item.pathError ) return item.pathError;
						if ( item.isPathPending ) return null;
						if ( ! item.path ) return __( 'Local path is required.' );
						return null;
					},
				},
			},
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
	// Compute validity across all fields together so a collapsed Advanced
	// settings section can still surface an error indicator on its toggle.
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
			// When the user toggles "Use custom domain" on for the first time,
			// seed the domain input with a sensible default derived from the
			// site name — matching Studio's add-site flow.
			if ( ! prev.useCustomDomain && next.useCustomDomain && ! next.customDomain ) {
				next.customDomain = generateCustomDomainFromSiteName( next.name );
			}
			return next;
		} );
	}, [] );

	// `isValid` already folds in `path`'s required + custom (pathError) rules,
	// so no extra gating needed here.
	// `isPathPending` is not reflected in `isValid` (the path validator returns
	// null during the window so the Advanced toggle stays clean), so gate
	// submit on it separately — the user shouldn't be able to race the
	// auto-generate and submit with an empty path.
	const canSubmit = isValid && ! isSubmitting && ! data.isPathPending;

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
