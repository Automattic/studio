import { __experimentalVStack as VStack } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { cx } from 'src/lib/cx';

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
		<Modal title={ __( "What's New in Studio" ) } onRequestClose={ onClose } className="max-w-xl">
			<VStack spacing={ 4 } className="p-4">
				<div className="text-lg">
					{ __(
						'Welcome to the latest version of Studio! Here are some of the new features and improvements:'
					) }
				</div>

				<div className={ cx( 'flex flex-col gap-4' ) }>
					<div className="flex flex-col gap-2">
						<h2 className="font-medium text-lg">{ __( 'Performance Improvements' ) }</h2>
						<p>
							{ __(
								"We've made significant performance enhancements to make Studio faster and more responsive."
							) }
						</p>
					</div>

					<div className="flex flex-col gap-2">
						<h2 className="font-medium text-lg">{ __( 'Enhanced UI' ) }</h2>
						<p>
							{ __(
								'The user interface has been refined for a better experience with improved navigation and accessibility.'
							) }
						</p>
					</div>

					<div className="flex flex-col gap-2">
						<h2 className="font-medium text-lg">{ __( 'Bug Fixes' ) }</h2>
						<p>{ __( "We've resolved several issues to ensure a smoother experience." ) }</p>
					</div>
				</div>

				<div className="flex justify-end mt-4">
					<Button variant="primary" onClick={ onClose }>
						{ __( 'Got it!' ) }
					</Button>
				</div>
			</VStack>
		</Modal>
	);
}
