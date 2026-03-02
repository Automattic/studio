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
import { useState, useCallback, useEffect } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getVipIpcApi } from './vip-ipc';
import type { VipCliStatus } from '../types';
import type { AddonAddSiteFlowProps } from 'src/modules/addons/addon-api';

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

export function CreateVipSite( { onSubmit, onValidityChange }: AddonAddSiteFlowProps ) {
	const { __ } = useI18n();
	const [ showAdvanced, setShowAdvanced ] = useState( false );
	const [ vipCliStatus, setVipCliStatus ] = useState< VipCliStatus | null >( null );
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const [ submitError, setSubmitError ] = useState< string | null >( null );

	const [ slug, setSlug ] = useState( '' );
	const [ title, setTitle ] = useState( 'VIP Dev' );
	const [ phpVersion, setPhpVersion ] = useState( '8.2' );
	const [ multisite, setMultisite ] = useState( 'false' );
	const [ appCodePath, setAppCodePath ] = useState( '' );
	const [ muPluginsPath, setMuPluginsPath ] = useState( '' );
	const [ elasticsearch, setElasticsearch ] = useState( false );
	const [ phpmyadmin, setPhpmyadmin ] = useState( false );
	const [ xdebug, setXdebug ] = useState( false );
	const [ mailpit, setMailpit ] = useState( false );
	const [ photon, setPhoton ] = useState( false );
	const [ cron, setCron ] = useState( false );
	const [ mediaRedirectDomain, setMediaRedirectDomain ] = useState( '' );

	// Check VIP CLI status on mount
	useEffect( () => {
		const checkVipCli = async () => {
			try {
				const status = await getVipIpcApi().vipIsCliAvailable();
				setVipCliStatus( status );
			} catch {
				setVipCliStatus( { available: false, error: 'Failed to check VIP CLI status' } );
			}
		};
		void checkVipCli();
	}, [] );

	// Validate form and notify parent
	useEffect( () => {
		const isValid = slug.trim().length > 0 && ( vipCliStatus?.available ?? false );
		onValidityChange( isValid );
	}, [ slug, vipCliStatus, onValidityChange ] );

	const handleSelectAppCodePath = useCallback( async () => {
		const result = await getIpcApi().showOpenFolderDialog(
			__( 'Select Application Code Directory' ),
			appCodePath || ''
		);
		if ( result?.path ) {
			setAppCodePath( result.path );
		}
	}, [ __, appCodePath ] );

	const handleSelectMuPluginsPath = useCallback( async () => {
		const result = await getIpcApi().showOpenFolderDialog(
			__( 'Select MU Plugins Directory' ),
			muPluginsPath || ''
		);
		if ( result?.path ) {
			setMuPluginsPath( result.path );
		}
	}, [ __, muPluginsPath ] );

	const handleSubmit = useCallback( async () => {
		if ( isSubmitting ) return;
		setIsSubmitting( true );
		setSubmitError( null );
		try {
			const multisiteValue =
				multisite === 'false' ? false : ( multisite as 'subdomain' | 'subdirectory' );

			const result = await getVipIpcApi().vipCreateEnvironment( {
				slug,
				title: title || undefined,
				phpVersion,
				multisite: multisiteValue,
				appCodePath: appCodePath || undefined,
				muPluginsPath: muPluginsPath || undefined,
				elasticsearch,
				phpmyadmin,
				xdebug,
				mailpit,
				photon,
				cron,
				mediaRedirectDomain: mediaRedirectDomain || undefined,
			} );

			if ( ! result.success ) {
				setSubmitError( result.stderr || __( 'Failed to create VIP environment.' ) );
				return;
			}
			onSubmit();
		} catch ( err ) {
			setSubmitError( err instanceof Error ? err.message : String( err ) );
		} finally {
			setIsSubmitting( false );
		}
	}, [
		isSubmitting,
		slug,
		title,
		phpVersion,
		multisite,
		appCodePath,
		muPluginsPath,
		elasticsearch,
		phpmyadmin,
		xdebug,
		mailpit,
		photon,
		cron,
		mediaRedirectDomain,
		onSubmit,
		__,
	] );

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

			<div className="w-full space-y-4">
				<TextControl
					label={ __( 'Environment Slug' ) }
					help={ __( 'A unique name for this environment (e.g., my-vip-site)' ) }
					value={ slug }
					onChange={ ( value ) => setSlug( value.toLowerCase().replace( /\s+/g, '-' ) ) }
					placeholder="my-vip-site"
					__nextHasNoMarginBottom
				/>

				<TextControl
					label={ __( 'WordPress Site Title' ) }
					value={ title }
					onChange={ setTitle }
					placeholder="VIP Dev"
					__nextHasNoMarginBottom
				/>

				<SelectControl
					label={ __( 'PHP Version' ) }
					value={ phpVersion }
					options={ PHP_VERSIONS }
					onChange={ setPhpVersion }
					__nextHasNoMarginBottom
				/>

				<SelectControl
					label={ __( 'Multisite' ) }
					value={ multisite }
					options={ MULTISITE_OPTIONS }
					onChange={ setMultisite }
					__nextHasNoMarginBottom
				/>

				<div className="space-y-1">
					<Text className="text-[13px] font-medium text-gray-700">
						{ __( 'Application Code' ) }
					</Text>
					<HStack spacing={ 2 }>
						<TextControl
							value={ appCodePath }
							onChange={ setAppCodePath }
							placeholder={ __( 'Demo (default)' ) }
							className="flex-1"
							__nextHasNoMarginBottom
						/>
						<button
							type="button"
							onClick={ () => {
								void handleSelectAppCodePath();
							} }
							className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
						>
							{ __( 'Browse' ) }
						</button>
					</HStack>
					<Text className="text-[12px] text-gray-500">
						{ __( 'Leave empty to use demo code, or select your VIP app repository' ) }
					</Text>
				</div>

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
						<div className="space-y-1">
							<Text className="text-[13px] font-medium text-gray-700">
								{ __( 'VIP MU Plugins' ) }
							</Text>
							<HStack spacing={ 2 }>
								<TextControl
									value={ muPluginsPath }
									onChange={ setMuPluginsPath }
									placeholder={ __( 'Demo (default)' ) }
									className="flex-1"
									__nextHasNoMarginBottom
								/>
								<button
									type="button"
									onClick={ () => {
										void handleSelectMuPluginsPath();
									} }
									className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
								>
									{ __( 'Browse' ) }
								</button>
							</HStack>
						</div>

						<TextControl
							label={ __( 'Media Redirect Domain' ) }
							help={ __( 'Proxy missing media files from this domain' ) }
							value={ mediaRedirectDomain }
							onChange={ setMediaRedirectDomain }
							placeholder="https://example.com"
							__nextHasNoMarginBottom
						/>

						<VStack spacing={ 2 }>
							<Text className="text-[13px] font-medium text-gray-700">
								{ __( 'Optional Services' ) }
							</Text>
							<CheckboxControl
								label={ __( 'Elasticsearch (for Enterprise Search)' ) }
								checked={ elasticsearch }
								onChange={ setElasticsearch }
								__nextHasNoMarginBottom
							/>
							<CheckboxControl
								label={ __( 'phpMyAdmin' ) }
								checked={ phpmyadmin }
								onChange={ setPhpmyadmin }
								__nextHasNoMarginBottom
							/>
							<CheckboxControl
								label={ __( 'XDebug' ) }
								checked={ xdebug }
								onChange={ setXdebug }
								__nextHasNoMarginBottom
							/>
							<CheckboxControl
								label={ __( 'Mailpit (email testing)' ) }
								checked={ mailpit }
								onChange={ setMailpit }
								__nextHasNoMarginBottom
							/>
							<CheckboxControl
								label={ __( 'Photon (image optimization)' ) }
								checked={ photon }
								onChange={ setPhoton }
								__nextHasNoMarginBottom
							/>
							<CheckboxControl
								label={ __( 'Cron' ) }
								checked={ cron }
								onChange={ setCron }
								__nextHasNoMarginBottom
							/>
						</VStack>
					</VStack>
				) }

				{ submitError && (
					<div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
						{ submitError }
					</div>
				) }

				{ /* The parent modal controls the primary submit button via onValidityChange.
				     This hidden button allows submit via keyboard. */ }
				<button
					type="submit"
					className="sr-only"
					onClick={ () => {
						void handleSubmit();
					} }
					disabled={ isSubmitting }
					aria-hidden
				/>
			</div>
		</VStack>
	);
}
