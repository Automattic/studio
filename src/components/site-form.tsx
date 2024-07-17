import { Icon } from '@wordpress/components';
import { tip, warning } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent } from 'react';
import { cx } from '../lib/cx';
import FolderIcon from './folder-icon';
import TextControlComponent from './text-control';

interface FormPathInputComponentProps {
	value: string;
	onClick: () => void;
	error?: string;
	doesPathContainWordPress: boolean;
	isDisabled: boolean;
}

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
			{ ( error || doesPathContainWordPress ) && (
				<div
					id="site-path-error"
					role="alert"
					aria-atomic="true"
					className={ cx(
						'flex flex-row items-start a8c-helper-text pt-1.5 gap-1',
						error ? 'text-red-500' : '',
						doesPathContainWordPress ? 'text-a8c-gray-70' : ''
					) }
				>
					<Icon
						className={ cx( 'shrink-0 basis-4', error ? 'fill-red-500' : '' ) }
						icon={ error ? warning : tip }
						width={ 16 }
						height={ 16 }
					/>
					<p>{ error ? error : __( 'The existing WordPress site at this path will be added.' ) }</p>
				</div>
			) }
		</div>
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
} ) => {
	const { __ } = useI18n();

	return (
		<form className={ className } onSubmit={ onSubmit }>
			<div className="flex flex-col gap-6">
				<label className="flex flex-col gap-1.5 leading-4">
					<span className="font-semibold">{ __( 'Site name' ) }</span>
					<TextControlComponent onChange={ setSiteName } value={ siteName }></TextControlComponent>
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
};
