import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Modal from 'src/components/modal';
import WhatsNewContent from './whats-new-content';

interface WhatsNewStep {
	title: string;
	description: React.ReactNode;
	links?: Array< {
		url?: string;
		text: string;
		icon?: string;
	} >;
	illustration?: string;
	illustrationComponent?: React.ComponentType;
	className?: string;
	width?: string | number;
	height?: string | number;
}

interface WhatsNewModalProps {
	steps: WhatsNewStep[];
	isOpen: boolean;
	onClose: () => void;
	buttonClassName?: string;
}

const WhatsNewModal: React.FC< WhatsNewModalProps > = ( { steps, isOpen, onClose } ) => {
	const { __ } = useI18n();
	const [ currentStep, setCurrentStep ] = useState( 0 );

	const handleClose = useCallback( () => {
		setCurrentStep( 0 );
		onClose();
	}, [ onClose ] );

	const handleNext = useCallback( () => {
		if ( currentStep < steps.length - 1 ) {
			setCurrentStep( currentStep + 1 );
		} else {
			setCurrentStep( 0 );
		}
	}, [ currentStep, steps.length ] );

	if ( steps.length === 0 || ! isOpen ) {
		return null;
	}

	const currentStepData = steps[ currentStep ];

	return (
		<Modal
			size="medium"
			title={ __( "What's New" ) }
			isDismissible
			focusOnMount="firstContentElement"
			onRequestClose={ handleClose }
			className="max-h-[90%]"
		>
			<WhatsNewContent
				title={ currentStepData.title }
				description={ currentStepData.description }
				links={ currentStepData.links }
				illustration={ currentStepData.illustration }
				illustrationComponent={ currentStepData.illustrationComponent }
				width={ currentStepData.width }
				height={ currentStepData.height }
				isLastStep={ currentStep === steps.length - 1 }
				onNext={ handleNext }
				currentStep={ currentStep }
				totalSteps={ steps.length }
			/>
		</Modal>
	);
};

export default WhatsNewModal;
