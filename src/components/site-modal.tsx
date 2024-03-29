import { Icon } from '@wordpress/components';
import { tip } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { cx } from '../lib/cx';
import Button from './button';
import FolderIcon from './folder-icon';
import Modal from './modal';
import TextControlComponent from './text-control';

interface SiteModalProps {
	className?: string;
	isOpen: boolean;
	onRequestClose: () => void;
	title: string;
	primaryButtonLabel: string;
	onPrimaryAction: () => void;
	isPrimaryButtonDisabled?: boolean;
	isCancelDisabled?: boolean;
	isLoading?: boolean;
	children: React.ReactNode;
}

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
				aria-label={ `${ value }, ${ __( 'Select different local path' ) }` }
				className="flex flex-row items-stretch rounded-sm border border-[#949494] focus:border-a8c-blueberry focus:shadow-[0_0_0_0.5px_black] focus:shadow-a8c-blueberry outline-none transition-shadow transition-linear duration-100 [&_.local-path-icon]:focus:border-l-a8c-blueberry"
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
					className={ cx(
						'local-path-icon flex items-center py-[9px] px-2.5 border border-l-[#949494] border-t-0 border-r-0 border-b-0',
						isDisabled ? 'cursor-not-allowed' : ''
					) }
				>
					<FolderIcon className="text-[#3C434A]" />
				</div>
			</button>
			{ ( error || doesPathContainWordPress ) && (
				<div
					role="alert"
					aria-atomic="true"
					className={ cx(
						'flex flex-row items-start a8c-helper-text pt-1.5 gap-1',
						error ? 'text-red-500' : '',
						doesPathContainWordPress ? 'text-a8c-gray-70' : ''
					) }
				>
					<Icon className={ error ? 'fill-red-500' : '' } icon={ tip } width={ 16 } height={ 16 } />
					<p>{ error ? error : __( 'The existing WordPress site at this path will be added.' ) }</p>
				</div>
			) }
		</div>
	);
}

export const SiteForm = ( {
	className,
	siteName,
	setSiteName,
	sitePath,
	onSelectPath,
	error,
	doesPathContainWordPress = false,
	isPathInputDisabled = false,
}: {
	className?: string;
	siteName: string;
	setSiteName: ( name: string ) => void;
	sitePath: string;
	onSelectPath: () => void;
	error: string;
	doesPathContainWordPress?: boolean;
	isPathInputDisabled?: boolean;
} ) => {
	const { __ } = useI18n();

	return (
		<div className={ cx( 'flex flex-col gap-6', className ) }>
			<label className="flex flex-col gap-1.5 leading-4">
				<span className="font-semibold">{ __( 'Site name' ) }</span>
				<TextControlComponent onChange={ setSiteName } value={ siteName }></TextControlComponent>
			</label>
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
		</div>
	);
};

export const SiteModal = ( {
	isOpen,
	onRequestClose,
	title,
	primaryButtonLabel,
	onPrimaryAction,
	isPrimaryButtonDisabled = false,
	isCancelDisabled = false,
	isLoading = false,
	children,
	className,
}: SiteModalProps ) => {
	const { __ } = useI18n();

	if ( ! isOpen ) return null;

	return (
		<Modal
			className={ cx( 'w-[460px]', className ) }
			title={ title }
			isDismissible
			focusOnMount="firstContentElement"
			onRequestClose={ onRequestClose }
			onKeyDown={ ( event ) => {
				if ( event.key === 'Enter' && ! isPrimaryButtonDisabled && ! isLoading ) {
					onPrimaryAction();
				}
			} }
		>
			{ children }
			<div className="flex flex-row justify-end gap-x-5 mt-6">
				<Button onClick={ onRequestClose } disabled={ isCancelDisabled } variant="tertiary">
					{ __( 'Cancel' ) }
				</Button>
				<Button
					className="bg-a8c-blueberry hover:text-white text-white"
					variant="primary"
					isBusy={ isLoading }
					onClick={ onPrimaryAction }
					disabled={ isPrimaryButtonDisabled }
				>
					{ primaryButtonLabel }
				</Button>
			</div>
		</Modal>
	);
};
