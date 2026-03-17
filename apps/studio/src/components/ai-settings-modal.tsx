import { useI18n } from '@wordpress/react-i18n';
import Modal from 'src/components/modal';

interface AiSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	siteId: string;
}

export function AiSettingsModal( { isOpen, onClose, siteId: _siteId }: AiSettingsModalProps ) {
	const { __ } = useI18n();

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			title={ __( 'AI settings' ) }
			isDismissible
			onRequestClose={ onClose }
			size="medium"
			className="min-h-[350px] app-no-drag-region"
		>
			<div className="px-2 pb-4 flex gap-6 flex-col">
				{ /* AI settings panels will be added in a future PR */ }
			</div>
		</Modal>
	);
}
