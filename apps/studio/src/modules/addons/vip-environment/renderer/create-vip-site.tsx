import { SelectControl, Icon } from '@wordpress/components';
import { chevronRight, chevronDown } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useCallback, useEffect } from 'react';
import Button from 'src/components/button';
import TextControlComponent from 'src/components/text-control';
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
	{ label: 'No multisite', value: 'false' },
	{ label: 'Subdomain multisite', value: 'subdomain' },
	{ label: 'Subdirectory multisite', value: 'subdirectory' },
];

export function CreateVipSite( { onSubmit, onValidityChange, submitRef }: AddonAddSiteFlowProps ) {
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

	// Register submit function with parent stepper via submitRef
	useEffect( () => {
		if ( submitRef ) {
			submitRef.current = handleSubmit;
		}
		return () => {
			if ( submitRef ) {
				submitRef.current = null;
			}
		};
	}, [ submitRef, handleSubmit ] );

	if ( ! vipCliStatus ) {
		return (
			<div className="w-full max-w-md mx-auto text-sm text-gray-500">
				{ __( 'Checking VIP CLI status…' ) }
			</div>
		);
	}

	if ( ! vipCliStatus.available ) {
		return (
			<div className="w-full max-w-md mx-auto flex flex-col gap-4 text-center">
				<h2 className="text-2xl font-medium text-gray-900">{ __( 'VIP CLI Required' ) }</h2>
				<p className="text-[15px] text-gray-600">
					{ __(
						'The VIP CLI is required to create VIP Local Development Environments. Please install it first.'
					) }
				</p>
				<code className="text-[13px] text-gray-500 bg-gray-100 p-3 rounded">
					npm install -g @automattic/vip
				</code>
				{ vipCliStatus.error && <p className="text-[13px] text-red-600">{ vipCliStatus.error }</p> }
			</div>
		);
	}

	const chevronIcon = showAdvanced ? chevronDown : chevronRight;

	return (
		<div className="w-full max-w-md mx-auto flex flex-col gap-6">
			<div className="text-center">
				<h2 className="text-2xl font-medium text-gray-900">{ __( 'Create VIP site' ) }</h2>
				<p className="text-[13px] text-a8c-gray-50 mt-1">
					{ __( 'VIP CLI:' ) } { vipCliStatus.version }
				</p>
			</div>

			<label className="flex flex-col gap-1.5 leading-4">
				<span className="font-semibold">{ __( 'Environment slug' ) }</span>
				<TextControlComponent
					value={ slug }
					onChange={ ( value ) => setSlug( value.toLowerCase().replace( /\s+/g, '-' ) ) }
					placeholder="my-vip-site"
				/>
				<span className="text-a8c-gray-50 text-xs">
					{ __( 'A unique identifier for this environment (lowercase, hyphens allowed).' ) }
				</span>
			</label>

			<label className="flex flex-col gap-1.5 leading-4">
				<span className="font-semibold">{ __( 'Site title' ) }</span>
				<TextControlComponent value={ title } onChange={ setTitle } placeholder="VIP Dev" />
			</label>

			<div className="flex flex-col gap-1.5 leading-4">
				<label className="font-semibold" htmlFor="vip-php-version">
					{ __( 'PHP version' ) }
				</label>
				<SelectControl
					id="vip-php-version"
					value={ phpVersion }
					options={ PHP_VERSIONS }
					onChange={ setPhpVersion }
					__next40pxDefaultSize
					__nextHasNoMarginBottom
				/>
			</div>

			<div className="flex flex-col gap-1.5 leading-4">
				<label className="font-semibold" htmlFor="vip-multisite">
					{ __( 'Multisite' ) }
				</label>
				<SelectControl
					id="vip-multisite"
					value={ multisite }
					options={ MULTISITE_OPTIONS }
					onChange={ setMultisite }
					__next40pxDefaultSize
					__nextHasNoMarginBottom
				/>
			</div>

			<div className="flex flex-col gap-1.5 leading-4">
				<span className="font-semibold">{ __( 'Application code' ) }</span>
				<div className="flex gap-2">
					<TextControlComponent
						value={ appCodePath }
						onChange={ setAppCodePath }
						placeholder={ __( 'Demo (default)' ) }
						className="flex-1"
					/>
					<Button
						variant="secondary"
						onClick={ () => {
							void handleSelectAppCodePath();
						} }
					>
						{ __( 'Browse' ) }
					</Button>
				</div>
				<span className="text-a8c-gray-50 text-xs">
					{ __( 'Leave empty to use demo code, or select your VIP app repository.' ) }
				</span>
			</div>

			<div className="flex flex-row items-center">
				<Button
					className="pl-0"
					onClick={ () => setShowAdvanced( ! showAdvanced ) }
					data-testid="vip-advanced-settings-button"
				>
					<Icon size={ 24 } icon={ chevronIcon } />
					<div className="text-[13px] leading-[16px] ml-2">{ __( 'Advanced settings' ) }</div>
				</Button>
			</div>

			<div
				className={ cx(
					'transition-all duration-500 ease-in-out overflow-hidden flex flex-col gap-6 interpolate-size-allow-keywords',
					showAdvanced ? 'h-auto opacity-100' : 'h-0 opacity-0'
				) }
			>
				<div className="flex flex-col gap-1.5 leading-4">
					<span className="font-semibold">{ __( 'VIP MU plugins' ) }</span>
					<div className="flex gap-2">
						<TextControlComponent
							value={ muPluginsPath }
							onChange={ setMuPluginsPath }
							placeholder={ __( 'Demo (default)' ) }
							className="flex-1"
						/>
						<Button
							variant="secondary"
							onClick={ () => {
								void handleSelectMuPluginsPath();
							} }
						>
							{ __( 'Browse' ) }
						</Button>
					</div>
				</div>

				<label className="flex flex-col gap-1.5 leading-4">
					<span className="font-semibold">{ __( 'Media redirect domain' ) }</span>
					<TextControlComponent
						value={ mediaRedirectDomain }
						onChange={ setMediaRedirectDomain }
						placeholder="https://example.com"
					/>
					<span className="text-a8c-gray-50 text-xs">
						{ __( 'Proxy missing media files from this domain.' ) }
					</span>
				</label>

				<div className="flex flex-col gap-2">
					<span className="font-semibold">{ __( 'Optional services' ) }</span>
					{ [
						{
							id: 'vip-elasticsearch',
							label: __( 'Elasticsearch (Enterprise Search)' ),
							checked: elasticsearch,
							onChange: setElasticsearch,
						},
						{
							id: 'vip-phpmyadmin',
							label: __( 'phpMyAdmin' ),
							checked: phpmyadmin,
							onChange: setPhpmyadmin,
						},
						{ id: 'vip-xdebug', label: __( 'XDebug' ), checked: xdebug, onChange: setXdebug },
						{
							id: 'vip-mailpit',
							label: __( 'Mailpit (email testing)' ),
							checked: mailpit,
							onChange: setMailpit,
						},
						{
							id: 'vip-photon',
							label: __( 'Photon (image optimization)' ),
							checked: photon,
							onChange: setPhoton,
						},
						{ id: 'vip-cron', label: __( 'Cron' ), checked: cron, onChange: setCron },
					].map( ( { id, label, checked, onChange } ) => (
						<div key={ id } className="flex items-center gap-2">
							<input
								type="checkbox"
								id={ id }
								checked={ checked }
								onChange={ ( e ) => onChange( e.target.checked ) }
							/>
							<label htmlFor={ id }>{ label }</label>
						</div>
					) ) }
				</div>
			</div>

			{ submitError && (
				<div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
					{ submitError }
				</div>
			) }

			{ /* The parent stepper controls the primary submit button via onValidityChange + submitRef.
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
	);
}
