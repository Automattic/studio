import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	SelectControl,
	CheckboxControl,
	TextControl,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

export interface CreateVipSiteFormValues {
	slug: string;
	title: string;
	phpVersion: string;
	multisite: string;
	appCodePath: string;
	muPluginsPath: string;
	elasticsearch: boolean;
	phpmyadmin: boolean;
	xdebug: boolean;
	mailpit: boolean;
	photon: boolean;
	cron: boolean;
	mediaRedirectDomain: string;
}

interface CreateVipSiteProps {
	onSubmit: ( values: CreateVipSiteFormValues ) => void;
	onValidityChange: ( isValid: boolean ) => void;
	formRef?: React.RefObject< HTMLFormElement >;
}

const PHP_VERSIONS = [
	{ label: '8.2 (Recommended)', value: '8.2' },
	{ label: '8.3', value: '8.3' },
	{ label: '8.4', value: '8.4' },
	{ label: '8.5 (Experimental)', value: '8.5' },
];

const MULTISITE_OPTIONS = [
	{ label: 'No', value: 'false' },
	{ label: 'Yes - Subdomain', value: 'subdomain' },
	{ label: 'Yes - Subdirectory', value: 'subdirectory' },
];

function CreateVipSiteForm(
	{ onSubmit, onValidityChange, formRef }: CreateVipSiteProps,
	ref: React.Ref< { submit: () => void } >
) {
	const { __ } = useI18n();
	const [ showAdvanced, setShowAdvanced ] = useState( false );
	const [ vipCliStatus, setVipCliStatus ] = useState< {
		available: boolean;
		version?: string;
		error?: string;
	} | null >( null );

	const [ formValues, setFormValues ] = useState< CreateVipSiteFormValues >( {
		slug: '',
		title: 'VIP Dev',
		phpVersion: '8.2',
		multisite: 'false',
		appCodePath: '',
		muPluginsPath: '',
		elasticsearch: false,
		phpmyadmin: false,
		xdebug: false,
		mailpit: false,
		photon: false,
		cron: false,
		mediaRedirectDomain: '',
	} );

	// Check VIP CLI status on mount
	useEffect( () => {
		const checkVipCli = async () => {
			try {
				const status = await getIpcApi().isVipCliAvailable();
				setVipCliStatus( status );
			} catch {
				setVipCliStatus( { available: false, error: 'Failed to check VIP CLI status' } );
			}
		};
		void checkVipCli();
	}, [] );

	// Validate form and notify parent
	useEffect( () => {
		const isValid = formValues.slug.trim().length > 0 && ( vipCliStatus?.available ?? false );
		onValidityChange( isValid );
	}, [ formValues.slug, vipCliStatus, onValidityChange ] );

	const updateField = useCallback(
		< K extends keyof CreateVipSiteFormValues >(
			field: K,
			value: CreateVipSiteFormValues[ K ]
		) => {
			setFormValues( ( prev ) => ( { ...prev, [ field ]: value } ) );
		},
		[]
	);

	const handleSelectAppCodePath = useCallback( async () => {
		const result = await getIpcApi().showOpenFolderDialog(
			__( 'Select Application Code Directory' ),
			formValues.appCodePath || ''
		);
		if ( result?.path ) {
			updateField( 'appCodePath', result.path );
		}
	}, [ __, updateField, formValues.appCodePath ] );

	const handleSelectMuPluginsPath = useCallback( async () => {
		const result = await getIpcApi().showOpenFolderDialog(
			__( 'Select MU Plugins Directory' ),
			formValues.muPluginsPath || ''
		);
		if ( result?.path ) {
			updateField( 'muPluginsPath', result.path );
		}
	}, [ __, updateField, formValues.muPluginsPath ] );

	const handleSubmit = useCallback(
		( e: React.FormEvent ) => {
			e.preventDefault();
			onSubmit( formValues );
		},
		[ formValues, onSubmit ]
	);

	useImperativeHandle( ref, () => ( {
		submit: () => {
			formRef?.current?.requestSubmit();
		},
	} ) );

	if ( ! vipCliStatus ) {
		return (
			<VStack className="w-full max-w-md mx-auto" spacing={ 4 }>
				<Text>{ __( 'Checking VIP CLI status...' ) }</Text>
			</VStack>
		);
	}

	if ( ! vipCliStatus.available ) {
		return (
			<VStack className="w-full max-w-md mx-auto text-center" spacing={ 4 }>
				<Heading className="text-[24px] text-gray-900" weight={ 500 }>
					{ __( 'VIP CLI Required' ) }
				</Heading>
				<Text className="text-[15px] text-gray-600">
					{ __(
						'The VIP CLI is required to create VIP Local Development Environments. Please install it first.'
					) }
				</Text>
				<Text className="text-[13px] text-gray-500 font-mono bg-gray-100 p-3 rounded">
					npm install -g @automattic/vip
				</Text>
				{ vipCliStatus.error && (
					<Text className="text-[13px] text-red-600">{ vipCliStatus.error }</Text>
				) }
			</VStack>
		);
	}

	return (
		<VStack className="w-full max-w-md mx-auto" spacing={ 4 }>
			<VStack className="text-center mb-4" spacing={ 2 }>
				<Heading className="text-[24px] text-gray-900" weight={ 500 }>
					{ __( 'Create VIP Site' ) }
				</Heading>
				<Text className="text-[13px] text-gray-500">
					{ __( 'VIP CLI version:' ) } { vipCliStatus.version }
				</Text>
			</VStack>

			<form ref={ formRef } onSubmit={ handleSubmit } className="w-full space-y-4">
				{ /* Basic Settings */ }
				<TextControl
					label={ __( 'Environment Slug' ) }
					help={ __( 'A unique name for this environment (e.g., my-vip-site)' ) }
					value={ formValues.slug }
					onChange={ ( value ) =>
						updateField( 'slug', value.toLowerCase().replace( /\s+/g, '-' ) )
					}
					placeholder="my-vip-site"
					required
				/>

				<TextControl
					label={ __( 'WordPress Site Title' ) }
					value={ formValues.title }
					onChange={ ( value ) => updateField( 'title', value ) }
					placeholder="VIP Dev"
				/>

				<SelectControl
					label={ __( 'PHP Version' ) }
					value={ formValues.phpVersion }
					options={ PHP_VERSIONS }
					onChange={ ( value ) => updateField( 'phpVersion', value ) }
				/>

				<SelectControl
					label={ __( 'Multisite' ) }
					value={ formValues.multisite }
					options={ MULTISITE_OPTIONS }
					onChange={ ( value ) => updateField( 'multisite', value ) }
				/>

				{ /* Application Code Path */ }
				<div className="space-y-1">
					<Text className="text-[13px] font-medium text-gray-700">
						{ __( 'Application Code' ) }
					</Text>
					<HStack spacing={ 2 }>
						<TextControl
							value={ formValues.appCodePath }
							onChange={ ( value ) => updateField( 'appCodePath', value ) }
							placeholder={ __( 'Demo (default)' ) }
							className="flex-1"
						/>
						<button
							type="button"
							onClick={ handleSelectAppCodePath }
							className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
						>
							{ __( 'Browse' ) }
						</button>
					</HStack>
					<Text className="text-[12px] text-gray-500">
						{ __( 'Leave empty to use demo code, or select your VIP app repository' ) }
					</Text>
				</div>

				{ /* Advanced Settings Toggle */ }
				<button
					type="button"
					onClick={ () => setShowAdvanced( ! showAdvanced ) }
					className={ cx(
						'text-sm text-blue-600 hover:text-blue-800 underline',
						'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded'
					) }
				>
					{ showAdvanced ? __( 'Hide advanced settings' ) : __( 'Show advanced settings' ) }
				</button>

				{ showAdvanced && (
					<VStack className="pt-4 border-t border-gray-200" spacing={ 4 }>
						{ /* MU Plugins Path */ }
						<div className="space-y-1">
							<Text className="text-[13px] font-medium text-gray-700">
								{ __( 'VIP MU Plugins' ) }
							</Text>
							<HStack spacing={ 2 }>
								<TextControl
									value={ formValues.muPluginsPath }
									onChange={ ( value ) => updateField( 'muPluginsPath', value ) }
									placeholder={ __( 'Demo (default)' ) }
									className="flex-1"
								/>
								<button
									type="button"
									onClick={ handleSelectMuPluginsPath }
									className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
								>
									{ __( 'Browse' ) }
								</button>
							</HStack>
						</div>

						{ /* Media Redirect Domain */ }
						<TextControl
							label={ __( 'Media Redirect Domain' ) }
							help={ __( 'Proxy missing media files from this domain' ) }
							value={ formValues.mediaRedirectDomain }
							onChange={ ( value ) => updateField( 'mediaRedirectDomain', value ) }
							placeholder="https://example.com"
						/>

						{ /* Service Toggles */ }
						<VStack spacing={ 2 }>
							<Text className="text-[13px] font-medium text-gray-700">
								{ __( 'Optional Services' ) }
							</Text>
							<CheckboxControl
								label={ __( 'Elasticsearch (for Enterprise Search)' ) }
								checked={ formValues.elasticsearch }
								onChange={ ( value ) => updateField( 'elasticsearch', value ) }
							/>
							<CheckboxControl
								label={ __( 'phpMyAdmin' ) }
								checked={ formValues.phpmyadmin }
								onChange={ ( value ) => updateField( 'phpmyadmin', value ) }
							/>
							<CheckboxControl
								label={ __( 'XDebug' ) }
								checked={ formValues.xdebug }
								onChange={ ( value ) => updateField( 'xdebug', value ) }
							/>
							<CheckboxControl
								label={ __( 'Mailpit (email testing)' ) }
								checked={ formValues.mailpit }
								onChange={ ( value ) => updateField( 'mailpit', value ) }
							/>
							<CheckboxControl
								label={ __( 'Photon (image optimization)' ) }
								checked={ formValues.photon }
								onChange={ ( value ) => updateField( 'photon', value ) }
							/>
							<CheckboxControl
								label={ __( 'Cron' ) }
								checked={ formValues.cron }
								onChange={ ( value ) => updateField( 'cron', value ) }
							/>
						</VStack>
					</VStack>
				) }
			</form>
		</VStack>
	);
}

export default forwardRef( CreateVipSiteForm );
