import { __ } from '@wordpress/i18n';
import Modal from 'src/components/modal';
import FeedbackForm, {
	type FeedbackIdentityProp,
} from 'src/modules/feedback/components/feedback-form';

interface FeedbackModalProps {
	identity?: FeedbackIdentityProp;
	source?: 'menu' | 'settings' | 'crash';
	onClose: () => void;
}

export default function FeedbackModal( { identity, source, onClose }: FeedbackModalProps ) {
	return (
		<Modal
			title={ __( 'Share feedback' ) }
			isDismissible
			onRequestClose={ onClose }
			size="medium"
			className="app-no-drag-region"
		>
			<div className="px-2 pb-2">
				<FeedbackForm identity={ identity } source={ source } onSubmitted={ onClose } />
			</div>
		</Modal>
	);
}
