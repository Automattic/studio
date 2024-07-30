import { Icon } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { tip, warning, trash, chevronRight, chevronDown } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useRef, useState } from 'react';
import { STUDIO_DOCS_URL } from '../constants';
import { useFeatureFlags } from '../hooks/use-feature-flags';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import FolderIcon from './folder-icon';
import TextControlComponent from './text-control';

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

const SiteFormError = ( { error, tipMessage = '', className = '' }: SiteFormErrorProps ) => {
	return (
		( error || tipMessage ) && (
			<div
				id={ error ? 'error-message' : 'tip-message' }
				role="alert"
				aria-atomic="true"
				className={ cx(
					'flex items-start gap-1',
					error ? 'text-red-500' : 'text-a8c-gray-70',
					className
				) }
			>
				<Icon
					className={ cx( 'shrink-0 basis-4', error ? 'fill-red-500' : '' ) }
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
		<div className="flex flex-col">
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
				<div
					aria-hidden="true"
					className="local-path-icon flex items-center py-[9px] px-2.5 border border-l-[#949494] border-t-0 border-r-0 border-b-0"
				>
					<FolderIcon className="text-[#3C434A]" />
				</div>
			</button>
			<SiteFormError
				error={ error }
				tipMessage={
					doesPathContainWordPress ? 'The existing WordPress site at this path will be added.' : ''
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
						<div
							aria-hidden="true"
							className="local-path-icon flex items-center py-[9px] px-2.5 border border-l-0 border-t-0 border-r-0 border-b-0"
						>
							<FolderIcon className="text-[#3C434A]" />
						</div>
					) }
				</button>
				{ fileName && (
					<Button variant="icon" onClick={ handleIconClick }>
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
					accept=".zip,.sql,.tar,.gz"
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
}: {
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
} ) => {
	const { __ } = useI18n();
	const { importExportEnabled } = useFeatureFlags();

	const [ isAdvancedSettingsVisible, setAdvancedSettingsVisible ] = useState( false );

	const handleAdvancedSettingsClick = () => {
		setAdvancedSettingsVisible( ! isAdvancedSettingsVisible );
	};

	if ( importExportEnabled ) {
		return (
			<form className={ className } onSubmit={ onSubmit }>
				<div className="flex flex-col">
					<label className="flex flex-col gap-1.5 leading-4 mb-6">
						<span className="font-semibold">{ __( 'Site name' ) }</span>
						<TextControlComponent
							onChange={ setSiteName }
							value={ siteName }
						></TextControlComponent>
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
										__( 'Jetpack and WordPress backups supported. <button>Learn more</button>' ),
										{
											button: (
												<Button
													variant="link"
													className="text-xs"
													onClick={ () => getIpcApi().openURL( STUDIO_DOCS_URL ) }
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
												icon={ isAdvancedSettingsVisible ? chevronDown : chevronRight }
											/>
											<div className="text-[13px] leading-[16px] ml-2">
												{ __( 'Advanced settings' ) }
											</div>
										</Button>
									</div>
									<div
										className={ cx(
											'transition-height duration-500 ease-in-out overflow-hidden',
											isAdvancedSettingsVisible
												? 'max-h-96 opacity-100 mb-6'
												: 'max-h-0 opacity-0 mb-0'
										) }
									>
										<label
											className={ cx(
												'flex flex-col gap-1.5 leading-4 p-2',
												! isAdvancedSettingsVisible && 'hidden'
											) }
										>
											<span onClick={ onSelectPath } className="font-semibold">
												{ __( 'Local path' ) }
											</span>
											<FormPathInputComponent
												isDisabled={ isPathInputDisabled }
												doesPathContainWordPress={ doesPathContainWordPress }
												error={ error }
												value={ sitePath }
												onClick={ onSelectPath }
											/>
										</label>
									</div>
								</>
							) }
						</>
					) }
				</div>
				{ children }
			</form>
		);
	} else {
		return (
			<form className={ className } onSubmit={ onSubmit }>
				<div className="flex flex-col gap-6">
					<label className="flex flex-col gap-1.5 leading-4">
						<span className="font-semibold">{ __( 'Site name' ) }</span>
						<TextControlComponent
							onChange={ setSiteName }
							value={ siteName }
						></TextControlComponent>
					</label>
					{ onSelectPath && (
						<label className="flex flex-col gap-1.5 leading-4">
							<span onClick={ onSelectPath } className="font-semibold">
								{ __( 'Local path' ) }
							</span>
							<FormPathInputComponent
								isDisabled={ isPathInputDisabled }
								doesPathContainWordPress={ doesPathContainWordPress }
								error={ error }
								value={ sitePath }
								onClick={ onSelectPath }
							/>
						</label>
					) }
				</div>
				{ children }
			</form>
		);
	}
};
