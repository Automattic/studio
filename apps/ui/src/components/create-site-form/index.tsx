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
import { RecommendedPHPVersion, SupportedPHPVersions } from '@studio/common/types/php-versions';
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
	 * Initial "Site name" value. Applied once when first provided, so the form
	 * can seed a randomly-generated default without fighting user input on
	 * subsequent re-renders.
	 */
	defaultName?: string;
	existingDomainNames: string[];
	onSubmit: ( values: CreateSiteFormValues ) => void;
	onCancel: () => void;
	isSubmitting?: boolean;
	submitError?: string;
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
	phpVersion: SupportedPHPVersion;
	wpVersion: string;
	useCustomDomain: boolean;
	customDomain: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

const PHP_VERSION_ELEMENTS = SupportedPHPVersions.map( ( version ) => ( {
	value: version,
	label: version,
} ) );

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

/**
 * Runs the name→path auto-generation effect on behalf of the form. Called
 * from `CreateSiteForm` so it fires whether the Advanced settings section is
 * open or not — otherwise `data.path` would stay empty on first load and the
 * Advanced toggle would falsely show "1 error found" until the user
 * expanded it and `PathField` mounted.
 */
function usePathAutoGenerate(
	data: FormData,
	onChange: ( update: Partial< FormData > ) => void
) {
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
			if ( data.path || data.pathError ) {
				onChangeRef.current( { path: '', pathError: '' } );
			}
			return;
		}
		pendingNameRef.current = trimmed;
		let cancelled = false;
		void ( async () => {
			const result = await generateProposedPath( trimmed );
			if ( cancelled || pendingNameRef.current !== trimmed ) return;
			onChangeRef.current( { path: result.path, pathError: result.error ?? '' } );
		} )();
		return () => {
			cancelled = true;
		};
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
			customValidity={
				errorMessage ? { type: 'invalid', message: errorMessage } : undefined
			}
			help={
				<>
					{ __(
						'Select an empty directory or a directory with an existing WordPress site.'
					) }{ ' ' }
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
	defaultName,
	existingDomainNames,
	onSubmit,
	onCancel,
	isSubmitting,
	submitError,
}: CreateSiteFormProps ) {
	const [ data, setData ] = useState< FormData >( () => ( {
		name: '',
		path: '',
		hasCustomPath: false,
		pathError: '',
		phpVersion: RecommendedPHPVersion,
		wpVersion: DEFAULT_WORDPRESS_VERSION,
		useCustomDomain: false,
		customDomain: '',
		enableHttps: false,
		adminUsername: 'admin',
		adminPassword: generatePassword(),
		adminEmail: 'admin@localhost.com',
	} ) );

	// Seed the site name from `defaultName` the first time it resolves, as
	// long as the user hasn't typed anything yet. Fires once — subsequent
	// `defaultName` churn shouldn't clobber user input.
	const hasAppliedDefaultName = useRef( false );
	useEffect( () => {
		if ( hasAppliedDefaultName.current || ! defaultName ) return;
		hasAppliedDefaultName.current = true;
		setData( ( prev ) => ( prev.name ? prev : { ...prev, name: defaultName } ) );
	}, [ defaultName ] );

	const fields = useMemo< Field< FormData >[] >(
		() => [
			{
				id: 'name',
				type: 'text',
				label: __( 'Site name' ),
				isValid: { required: true },
			},
			{
				id: 'path',
				label: __( 'Local path' ),
				Edit: PathField,
				isValid: {
					required: true,
					custom: ( item: FormData ) => item.pathError || null,
				},
			},
			{
				id: 'phpVersion',
				type: 'text',
				label: __( 'PHP version' ),
				elements: PHP_VERSION_ELEMENTS,
			},
			{
				id: 'wpVersion',
				type: 'text',
				label: __( 'WordPress version' ),
				placeholder: DEFAULT_WORDPRESS_VERSION,
			},
			{
				id: 'adminUsername',
				type: 'text',
				label: __( 'Admin username' ),
				isValid: {
					required: true,
					custom: ( item: FormData ) => validateAdminUsername( item.adminUsername ) || null,
				},
			},
			{
				id: 'adminPassword',
				type: 'password',
				label: __( 'Admin password' ),
				isValid: { required: true },
			},
			{
				id: 'adminEmail',
				type: 'email',
				label: __( 'Admin email' ),
				isValid: {
					required: true,
					custom: ( item: FormData ) => validateAdminEmail( item.adminEmail ) || null,
				},
			},
			{
				id: 'useCustomDomain',
				type: 'boolean',
				label: __( 'Use custom domain' ),
				description: __( 'Your system password will be required to set up the domain.' ),
			},
			{
				id: 'customDomain',
				type: 'text',
				label: __( 'Domain name' ),
				isVisible: ( item: FormData ) => item.useCustomDomain,
				isValid: {
					custom: ( item: FormData ) => {
						const value = item.customDomain || generateCustomDomainFromSiteName( item.name );
						return (
							getDomainNameValidationError( item.useCustomDomain, value, existingDomainNames ) ||
							null
						);
					},
				},
			},
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
	const canSubmit = isValid && ! isSubmitting;

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
					{ __( 'Create site' ) }
				</Button>
			</div>
		</form>
	);
}
