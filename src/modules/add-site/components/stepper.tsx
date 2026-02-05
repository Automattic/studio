import { __experimentalHStack as HStack, __experimentalText as Text } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import { useStepper } from '../hooks/use-stepper';

interface StepperProps {
	currentPath?: string;
	onBack?: () => void;
	onBlueprintContinue?: () => void;
	onBlueprintDeeplinkContinue?: () => void;
	onBackupContinue?: () => void;
	onPullRemoteContinue?: () => void;
	onCreateSubmit?: ( event: FormEvent ) => void;
	onVipSubmit?: ( event: FormEvent ) => void;
	canSubmitBlueprint?: boolean;
	canSubmitBlueprintDeeplink?: boolean;
	canSubmitBackup?: boolean;
	canSubmitPullRemote?: boolean;
	canSubmitCreate?: boolean;
	canSubmitVip?: boolean;
}

export default function Stepper( {
	currentPath,
	onBack,
	onBlueprintContinue,
	onBlueprintDeeplinkContinue,
	onBackupContinue,
	onPullRemoteContinue,
	onCreateSubmit,
	onVipSubmit,
	canSubmitBlueprint,
	canSubmitBlueprintDeeplink,
	canSubmitBackup,
	canSubmitPullRemote,
	canSubmitCreate,
	canSubmitVip,
}: StepperProps ) {
	const { __ } = useI18n();
	const { steps, isVisible, actionButton, onSubmit, canSubmit } = useStepper( {
		onBlueprintContinue,
		onBlueprintDeeplinkContinue,
		onBackupContinue,
		onPullRemoteContinue,
		onCreateSubmit,
		onVipSubmit,
		canSubmitBlueprint,
		canSubmitBlueprintDeeplink,
		canSubmitBackup,
		canSubmitPullRemote,
		canSubmitCreate,
		canSubmitVip,
	} );

	if ( ! isVisible ) {
		return null;
	}

	return (
		<div className="flex justify-between items-center p-5">
			<HStack spacing={ 6 } alignment="left">
				{ steps.map( ( step, index ) => {
					const stepNumber = index + 1;

					return (
						<HStack
							key={ step.id }
							spacing={ 2 }
							alignment="left"
							className={ cx(
								'w-fit',
								step.isClickable && 'cursor-pointer hover:opacity-80 transition-opacity'
							) }
							onClick={ step.onClick }
						>
							<div
								className={ cx(
									`w-6 h-6 rounded-full flex items-center justify-center text-xs font-regular border-[1.5px] bg-transparent `,
									step.isCurrent ? 'text-gray-900 border-gray-900' : 'border-gray-500 text-gray-500'
								) }
							>
								{ stepNumber }
							</div>
							<Text
								className={ cx(
									`text-sm font-regular`,
									step.isCurrent ? 'text-gray-900' : 'text-gray-500'
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
					<Button
						variant="primary"
						type="button"
						onClick={ onSubmit }
						disabled={ ! canSubmit }
						data-testid="stepper-action-button"
					>
						{ actionButton.label }
					</Button>
				) }
			</div>
		</div>
	);
}
