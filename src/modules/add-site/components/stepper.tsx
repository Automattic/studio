import {
	__experimentalHStack as HStack,
	__experimentalText as Text,
	useNavigator,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import { useStepper } from '../hooks/use-stepper';

interface StepperProps {
	currentPath?: string;
	onBack?: () => void;
	onBlueprintContinue?: () => void;
	onBackupContinue?: () => void;
	onCreateSubmit?: ( event: FormEvent ) => void;
	canSubmitBlueprint?: boolean;
	canSubmitBackup?: boolean;
	canSubmitCreate?: boolean;
}

export default function Stepper( {
	currentPath,
	onBack,
	onBlueprintContinue,
	onBackupContinue,
	onCreateSubmit,
	canSubmitBlueprint,
	canSubmitBackup,
	canSubmitCreate,
}: StepperProps ) {
	const { __ } = useI18n();
	const { goTo } = useNavigator();
	const { steps, isVisible, actionButton, onSubmit, canSubmit } = useStepper( {
		onBlueprintContinue,
		onBackupContinue,
		onCreateSubmit,
		canSubmitBlueprint,
		canSubmitBackup,
		canSubmitCreate,
	} );

	if ( ! isVisible ) {
		return null;
	}

	return (
		<div className="flex justify-between items-center p-6">
			<HStack spacing={ 6 } alignment="left">
				{ steps.map( ( step, index ) => {
					const isCurrent = step.status === 'current';
					const isCompleted = step.status === 'completed';
					const isClickable = isCompleted && step.path;
					const stepNumber = index + 1;

					const handleStepClick = () => {
						if ( isClickable && step.path ) {
							goTo( step.path );
						}
					};

					return (
						<HStack
							key={ step.id }
							spacing={ 2 }
							alignment="left"
							className={ cx(
								'w-fit',
								isClickable && 'cursor-pointer hover:opacity-80 transition-opacity'
							) }
							onClick={ handleStepClick }
						>
							<div
								className={ cx(
									`w-6 h-6 rounded-full flex items-center justify-center text-xs font-normal border-2  bg-transparent `,
									isCurrent ? 'text-gray-900 border-gray-900' : 'border-gray-500 text-gray-500'
								) }
							>
								{ stepNumber }
							</div>
							<Text
								className={ cx(
									`text-sm`,
									isCurrent ? 'text-gray-900 font-medium' : 'text-gray-500'
								) }
							>
								{ step.label }
							</Text>
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
