import {
	__experimentalHStack as HStack,
	Icon,
	__experimentalText as Text,
} from '@wordpress/components';
import { published, border } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { useStepper } from '../hooks/use-stepper';

interface StepperProps {
	currentPath?: string;
	onBack?: () => void;
	onSubmit?: () => void;
	canSubmit?: boolean;
}

export default function Stepper( { currentPath, onBack, onSubmit, canSubmit }: StepperProps ) {
	const { __ } = useI18n();
	const { steps, isVisible, actionButton } = useStepper();

	if ( ! isVisible ) {
		return null;
	}

	return (
		<div className="flex justify-between items-center p-6">
			<HStack spacing={ 6 } alignment="left">
				{ steps.map( ( step ) => {
					const isCompleted = step.status === 'completed';
					const isCurrent = step.status === 'current';

					return (
						<HStack key={ step.id } spacing={ 2 } alignment="left" className="w-fit">
							<Icon
								icon={ isCompleted || isCurrent ? published : border }
								size={ 30 }
								className={ isCompleted && ! isCurrent ? 'fill-a8c-blue-50' : 'fill-gray-500' }
							/>
							<Text className={ 'text-base text-gray-500' }>{ step.label }</Text>
						</HStack>
					);
				} ) }
			</HStack>

			<div className="flex gap-4">
				{ currentPath && currentPath !== '/' && onBack && (
					<Button variant="tertiary" onClick={ onBack }>
						{ __( 'Back' ) }
					</Button>
				) }
				{ actionButton?.isVisible && onSubmit && (
					<Button variant="primary" onClick={ onSubmit } disabled={ ! canSubmit }>
						{ actionButton.label }
					</Button>
				) }
			</div>
		</div>
	);
}
