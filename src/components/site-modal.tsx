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
			<div className="flex flex-row">
				<TextControlComponent
					disabled={ true }
					className="[&_input]:!rounded-l-sm [&_input]:!rounded-r-none [&_input]:!bg-white w-full"
					value={ value }
					// eslint-disable-next-line @typescript-eslint/no-empty-function
					onChange={ () => {} }
				/>
				<div
					data-testid="select-path-button"
					// eslint-disable-next-line @typescript-eslint/no-empty-function
					onClick={ isDisabled ? () => {} : onClick }
					className={ cx(
						'flex items-center py-[9px] px-2.5 border border-l-0 border-y-[#949494] border-r-[#949494] rounded-r-sm',
						isDisabled ? 'cursor-not-allowed' : ''
					) }
				>
					<FolderIcon className="text-[#3C434A]" />
				</div>
			</div>
			{ ( error || doesPathContainWordPress ) && (
				<div
					className={ cx(
						'flex flex-row items-center a8c-helper-text pt-1.5',
						error ? 'text-red-500' : '',
						doesPathContainWordPress ? 'text-a8c-gray-70' : ''
					) }
				>
					<Icon className={ error ? 'fill-red-500' : '' } icon={ tip } width={ 14 } height={ 14 } />
					<p>{ error ? error : __( 'The existing WordPress site at this path will be added.' ) }</p>
				</div>
			) }
		</div>
	);
}

export const ModalContent = ( {
	siteName,
	setSiteName,
	sitePath,
	onSelectPath,
	error,
	doesPathContainWordPress = false,
	isPathInputDisabled = false,
}: {
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
		<div className="flex flex-col gap-6">
			<label className="flex flex-col gap-1.5 leading-4">
				<span className="font-semibold">{ __( 'Site name' ) }</span>
				<TextControlComponent
					autoFocus
					onChange={ setSiteName }
					value={ siteName }
				></TextControlComponent>
			</label>
			<label className="flex flex-col gap-1.5 leading-4">
				<span className="font-semibold">{ __( 'Local path' ) }</span>
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
			onRequestClose={ onRequestClose }
		>
			{ children }
			<div className="flex flex-row justify-end gap-x-5 mt-6">
				<Button onClick={ onRequestClose } disabled={ isCancelDisabled } variant="tertiary">
					{ __( 'Cancel' ) }
				</Button>
				<Button
					data-testid="site-action-button"
					className="bg-a8c-blueberry hover:text-white text-white"
					variant="primary"
					onClick={ onPrimaryAction }
					disabled={ isPrimaryButtonDisabled }
				>
					{ primaryButtonLabel }
				</Button>
			</div>
		</Modal>
	);
};
