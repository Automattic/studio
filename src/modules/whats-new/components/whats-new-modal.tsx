import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import Modal from 'src/components/modal';

interface WhatsNewModalProps {
	showModal: boolean;
	onClose: () => void;
}

export default function WhatsNewModal( { showModal, onClose }: WhatsNewModalProps ) {
	const { __ } = useI18n();

	if ( ! showModal ) {
		return null;
	}

	return (
		<Modal title={ __( "What's New in Studio" ) } onRequestClose={ onClose } className="max-w-md">
			<div className="p-4">
				<p className="mb-4">{ __( 'Welcome to the latest version of Studio!' ) }</p>
				<div className="flex justify-end">
					<Button variant="primary" onClick={ onClose }>
						{ __( 'OK' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}
