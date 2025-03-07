import { SupportedPHPVersion, SupportedPHPVersionsList } from '@php-wasm/universal';
import { Icon, SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { tip, warning, trash, chevronRight, chevronDown, chevronLeft } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Button from 'src/components/button';
import FolderIcon from 'src/components/folder-icon';
import TextControlComponent from 'src/components/text-control';
import { ACCEPTED_IMPORT_FILE_TYPES } from 'src/constants';
import { useDocsLink } from 'src/hooks/use-docs-link';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { cx } from 'src/lib/cx';
import { generateCustomDomainFromSiteName } from 'src/lib/generate-custom-domain';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	wordpressVersionsSelectors,
	wordpressVersionsThunks,
} from 'src/stores/wordpress-versions-slice';
import { DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';

interface FormPathInputComponentProps {
	value: string;
	onClick: () => void;
	error?: string;
	doesPathContainWordPress: boolean;
	isDisabled: boolean;
}

interface FormImportComponentProps {
	value?: File | null;
	onFileSelected?: ( file: File ) => void;
	onClear?: () => void;
	onChange: ( file: File | null ) => void;
	error?: string;
	placeholder?: string;
}

interface SiteFormErrorProps {
	error?: string;
	tipMessage?: string;
	className?: string;
}

interface SiteFormBaseProps {
	className?: string;
	children?: React.ReactNode;
	siteName: string;
	setSiteName: ( name: string ) => void;
	sitePath?: string;
	onSelectPath?: () => void;
	error: string;
	doesPathContainWordPress?: boolean;
	isPathInputDisabled?: boolean;
	onSubmit: ( event: FormEvent ) => void;
	fileForImport?: File | null;
	setFileForImport?: ( file: File | null ) => void;
	onFileSelected?: ( file: File ) => void;
	fileError?: string;
	useCustomDomain?: boolean;
	setUseCustomDomain?: ( use: boolean ) => void;
	customDomain?: string;
	setCustomDomain?: ( domain: string ) => void;
	customDomainError?: string;
}

// TODO: Add all this props to the SiteForm component once we have the versions selects in edit site page.
interface SiteFormWithVersionsProps extends SiteFormBaseProps {
	// TODO: allowVersionsChange should be removed once we have the versions selects in edit site page.
	allowVersionsChange: true;
	phpVersion: SupportedPHPVersion;
	setPhpVersion: ( version: SupportedPHPVersion ) => void;
	wpVersion: string;
	setWpVersion: ( version: string ) => void;
}

// TODO: Remove this once we have the versions selects in edit site page.
interface SiteFormWithoutVersionsProps extends SiteFormBaseProps {
	allowVersionsChange?: false;
	phpVersion?: never;
	setPhpVersion?: never;
	wpVersion?: never;
	setWpVersion?: never;
}

type SiteFormProps = SiteFormWithVersionsProps | SiteFormWithoutVersionsProps;

const SiteFormError = ( { error, tipMessage = '', className = '' }: SiteFormErrorProps ) => {
	return (
		( error || tipMessage ) && (
			<div
				id={ error ? 'error-message' : 'tip-message' }
				role="alert"
				aria-atomic="true"
				className={ cx(
					'flex items-start gap-1 text-xs',
					error ? 'text-red-500' : 'text-a8c-gray-50',
					className
				) }
			>
				<Icon
					className={ cx( 'shrink-0 basis-4', error ? 'fill-red-500' : 'fill-a8c-gray-50' ) }
					icon={ error ? warning : tip }
					width={ 16 }
					height={ 16 }
				/>
				<p>{ error ? error : __( tipMessage ) }</p>
			</div>
		)
	);
};
function FormPathInputComponent( {
	value,
	onClick,
	error,
	doesPathContainWordPress,
	isDisabled = false,
}: FormPathInputComponentProps ) {
	const { __ } = useI18n();
	return (
		<div className="flex flex-col gap-2">
			<button
				aria-invalid={ !! error }
				/**
				 * The below `aria-describedby` presumes the error message always
				 * relates to the local path input, which is true currently as it is the
				 * only data validation in place. If we ever introduce additional data
				 * validation we need to expand the robustness of this
				 * `aria-describedby` attribute so that it only targets relevant error
				 * messages.
				 */
				aria-describedby={ error ? 'site-path-error' : undefined }
				type="button"
				aria-label={ `${ value }, ${ __( 'Select different local path' ) }` }
				className={ cx(
					'flex flex-row items-stretch rounded-sm border border-[#949494] focus:border-a8c-blueberry focus:shadow-[0_0_0_0.5px_black] focus:shadow-a8c-blueberry outline-none transition-shadow transition-linear duration-100 [&_.local-path-icon]:focus:border-l-a8c-blueberry [&:disabled]:cursor-not-allowed',
					error ? 'border-red-500 [&_.local-path-icon]:border-l-red-500' : ''
				) }
				data-testid="select-path-button"
				disabled={ isDisabled }
				onClick={ onClick }
			>
				<TextControlComponent
					aria-hidden="true"
					disabled={ true }
					className="[&_.components-text-control\_\_input]:bg-transparent [&_.components-text-control\_\_input]:border-none [&_input]:pointer-events-none w-full"
					value={ value }
					// eslint-disable-next-line @typescript-eslint/no-empty-function
					onChange={ () => {} }
				/>
				<div aria-hidden="true" className="local-path-icon flex items-center py-[9px] px-2.5">
					<FolderIcon className="text-[#3C434A]" />
				</div>
			</button>
			<SiteFormError
				error={ error }
				tipMessage={
					doesPathContainWordPress
						? __( 'The existing WordPress site at this path will be added.' )
						: ''
				}
			/>
		</div>
	);
}

function FormImportComponent( {
	value,
	onFileSelected,
	onClear,
	error,
	placeholder,
}: FormImportComponentProps ) {
	const fileName = value ? value.name : '';

	const inputFileRef = useRef< HTMLInputElement >( null );

	const handleIconClick = ( event: FormEvent ) => {
		event.stopPropagation();
		if ( onClear ) {
			onClear();
			if ( inputFileRef.current ) {
				inputFileRef.current.value = '';
			}
		}
	};

	const handleFileChange = ( event: React.ChangeEvent< HTMLInputElement > ) => {
		if ( ! onFileSelected ) {
			return;
		}
		if ( event.target.files && event.target.files[ 0 ] ) {
			onFileSelected( event.target.files[ 0 ] );
		}
	};

	return (
		<>
			<div className="flex items-center">
				<button
					aria-invalid={ !! error }
					type="button"
					aria-label={ `${ value }, ${ __( 'Select different file' ) }` }
					className={ cx(
						'flex items-center flex-grow rounded-sm border border-[#949494] focus:border-a8c-blueberry focus:shadow-[0_0_0_0.5px_black] focus:shadow-a8c-blueberry outline-none transition-shadow transition-linear duration-100 [&_.local-path-icon]:focus:border-l-a8c-blueberry [&:disabled]:cursor-not-allowed',
						error ? 'border-red-500 [&_.local-path-icon]:border-l-red-500' : '',
						fileName ? 'border-r-0 rounded-r-none focus:border' : ''
					) }
					onClick={ () => inputFileRef.current?.click() }
				>
					<TextControlComponent
						aria-hidden="true"
						disabled={ true }
						placeholder={ placeholder }
						className="flex-grow [&_.components-text-control\_\_input]:bg-transparent [&_.components-text-control\_\_input]:border-none [&_input]:pointer-events-none [&_.components-text-control\_\_input]:text-sm w-full [&_.components-text-control\_\_input]:truncate"
						value={ fileName }
						// eslint-disable-next-line @typescript-eslint/no-empty-function
						onChange={ () => {} }
					/>
					{ ! fileName && (
						<div aria-hidden="true" className="local-path-icon flex items-center py-[12px] px-2.5">
							<FolderIcon className="text-[#3C434A]" />
						</div>
					) }
				</button>
				{ fileName && (
					<Button variant="icon" onClick={ handleIconClick } isDestructive={ true }>
						<div
							aria-hidden="true"
							className="flex items-center py-[10px] px-2.5 rounded-tr-sm rounded-br-sm border border-[#949494] border-l-0"
						>
							<Icon size={ 20 } icon={ trash } />
						</div>
					</Button>
				) }
				<input
					id="backup-file"
					ref={ inputFileRef }
					className="hidden"
					type="file"
					data-testid="backup-file"
					accept={ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) }
					onChange={ handleFileChange }
				/>
			</div>
			<SiteFormError error={ error } className="pt-0" />
		</>
	);
}
export const SiteForm = ( {
	className,
	children,
	siteName,
	setSiteName,
	phpVersion,
	setPhpVersion,
	wpVersion,
	setWpVersion,
	sitePath = '',
	onSelectPath,
	error,
	doesPathContainWordPress = false,
	isPathInputDisabled = false,
	onSubmit,
	fileForImport,
	setFileForImport,
	onFileSelected,
	fileError,
	allowVersionsChange = false,
	useCustomDomain,
	setUseCustomDomain,
	customDomain,
	setCustomDomain,
	customDomainError,
}: SiteFormProps ) => {
	const { __, isRTL } = useI18n();
	const getDocsLink = useDocsLink();
	const { wpVersionsEnabled } = useFeatureFlags();
	const dispatch = useAppDispatch();
	const wpVersions = useRootSelector(
		wordpressVersionsSelectors.selectWordPressVersionsWithLatest
	);
	const wpVersionsStatus = useRootSelector( ( state ) => state.wordpressVersions.status );

	useEffect( () => {
		if ( wpVersionsEnabled && allowVersionsChange && wpVersionsStatus === 'idle' ) {
			dispatch( wordpressVersionsThunks.fetchWordPressVersions() );
		}
	}, [ wpVersionsEnabled, allowVersionsChange, wpVersionsStatus, dispatch ] );

	const [ isAdvancedSettingsVisible, setAdvancedSettingsVisible ] = useState( false );

	const handleAdvancedSettingsClick = () => {
		setAdvancedSettingsVisible( ! isAdvancedSettingsVisible );
	};

	let chevronIcon;

	if ( isAdvancedSettingsVisible ) {
		chevronIcon = chevronDown;
	} else if ( isRTL() ) {
		chevronIcon = chevronLeft;
	} else {
		chevronIcon = chevronRight;
	}
	const generatedDomainName = generateCustomDomainFromSiteName( siteName );

	return (
		<form className={ className } onSubmit={ onSubmit }>
			<div className="flex flex-col">
				<label className="flex flex-col gap-1.5 leading-4 mb-6">
					<span className="font-semibold">{ __( 'Site name' ) }</span>
					<TextControlComponent onChange={ setSiteName } value={ siteName }></TextControlComponent>
				</label>

				{ setFileForImport && (
					<>
						<div className="flex flex-col gap-1.5 leading-4 mb-6">
							<label className="font-semibold">
								{ __( 'Import a backup' ) }
								<span className="font-normal">{ __( ' (optional)' ) }</span>
							</label>
							<span className="text-a8c-gray-50 text-xs">
								{ createInterpolateElement(
									__(
										'Import a Jetpack backup or a full-site backup in another format. <button>Learn more</button>'
									),
									{
										button: (
											<Button
												variant="link"
												className="text-xs"
												onClick={ () => getIpcApi().openURL( getDocsLink( 'importExport' ) ) }
											/>
										),
									}
								) }
							</span>
							<FormImportComponent
								placeholder={ __( 'Select or drop a file' ) }
								value={ fileForImport }
								onChange={ setFileForImport }
								onClear={ () => setFileForImport( null ) }
								onFileSelected={ onFileSelected }
								error={ fileError }
							/>
						</div>
						{ onSelectPath && (
							<>
								<div className="flex flex-row items-center mb-0">
									<Button className="pl-0" onClick={ handleAdvancedSettingsClick }>
										<Icon
											size={ 24 }
											icon={ chevronIcon }
											className={ error ? 'text-red-500' : '' }
										/>
										<div
											className={ cx(
												'text-[13px] leading-[16px] ml-2',
												error ? 'text-red-500' : ''
											) }
										>
											{ __( 'Advanced settings' ) }
										</div>
									</Button>
									{ ( error || customDomainError ) && (
										<span className="text-red-500 text-[13px] leading-[16px] ml-2 flex items-center">
											<Icon icon={ warning } size={ 16 } className="mr-1 fill-red-500" />
											{ error && customDomainError
												? __( '2 errors found' )
												: __( '1 error found' ) }
										</span>
									) }
								</div>
								<div
									className={ cx(
										'transition-all duration-500 ease-in-out overflow-hidden flex flex-col gap-2',
										isAdvancedSettingsVisible ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
									) }
								>
									<div className={ cx( 'flex flex-col gap-1.5 leading-4 p-2' ) }>
										<label onClick={ onSelectPath } className="font-semibold">
											{ __( 'Local path' ) }
										</label>
										<span className="text-a8c-gray-50 text-xs">
											{ createInterpolateElement(
												__(
													'Select an empty directory or a directory with an existing WordPress site. <button>Learn more</button>'
												),
												{
													button: (
														<Button
															variant="link"
															className="text-xs"
															onClick={ () => getIpcApi().openURL( getDocsLink( 'sites' ) ) }
														/>
													),
												}
											) }
										</span>
										<FormPathInputComponent
											isDisabled={ isPathInputDisabled }
											doesPathContainWordPress={ doesPathContainWordPress }
											error={ error }
											value={ sitePath }
											onClick={ onSelectPath }
										/>
										{ wpVersionsEnabled && allowVersionsChange && (
											<div className="grid grid-cols-2 gap-4 mt-4">
												<div className="flex flex-col gap-1.5 leading-4">
													<label className="font-semibold">{ __( 'PHP version' ) }</label>
													<SelectControl
														value={ phpVersion }
														options={ SupportedPHPVersionsList.map( ( version ) => {
															return {
																label: version,
																value: version,
															};
														} ) }
														onChange={ setPhpVersion as ( value: string ) => void }
														__next40pxDefaultSize
													/>
												</div>
												<div className="flex flex-col gap-1.5 leading-4">
													<label className="font-semibold">{ __( 'WordPress version' ) }</label>
													<SelectControl
														value={ wpVersion }
														options={
															wpVersions.length > 0
																? wpVersions
																: [
																		{
																			label: DEFAULT_WORDPRESS_VERSION,
																			value: DEFAULT_WORDPRESS_VERSION,
																		},
																  ]
														}
														onChange={ setWpVersion }
														__next40pxDefaultSize
													/>
												</div>
											</div>
										) }
									</div>

									{ setUseCustomDomain && setCustomDomain && (
										<div
											className={ cx(
												isAdvancedSettingsVisible ? 'py-2' : 'p-2',
												! isAdvancedSettingsVisible && 'hidden'
											) }
										>
											<div className="flex items-center gap-2">
												<input
													type="checkbox"
													id="use-custom-domain"
													checked={ useCustomDomain }
													onChange={ ( e ) => setUseCustomDomain( e.target.checked ) }
												/>
												<label htmlFor="use-custom-domain">{ __( 'Use custom domain' ) }</label>
											</div>
											<div className="text-a8c-gray-50 text-xs pt-2">
												{ __(
													'This will require your password to authorize changes to the hosts file.'
												) }
											</div>
										</div>
									) }

									{ useCustomDomain && setCustomDomain && (
										<div
											className={ cx(
												'flex flex-col gap-2',
												isAdvancedSettingsVisible ? 'py-2' : 'p-2',
												! isAdvancedSettingsVisible && 'hidden'
											) }
										>
											<label htmlFor="custom-domain" className="font-semibold">
												{ __( 'Domain name' ) }
											</label>
											<TextControlComponent
												id="custom-domain"
												value={ customDomain ?? '' }
												onChange={ setCustomDomain }
												placeholder={ generatedDomainName }
											/>
											{ customDomainError && <SiteFormError error={ customDomainError } /> }
										</div>
									) }
								</div>
							</>
						) }
					</>
				) }
			</div>
			{ children }
		</form>
	);
};
