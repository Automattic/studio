import { useNavigator } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useMemo } from 'react';

interface StepperStep {
	id: string;
	label: string;
	status?: 'completed' | 'current' | 'pending';
	path?: string;
}

interface StepperConfig {
	onBlueprintContinue?: () => void;
	onBackupContinue?: () => void;
	onCreateSubmit?: ( event: FormEvent ) => void;
	canSubmitBlueprint?: boolean;
	canSubmitBackup?: boolean;
	canSubmitCreate?: boolean;
}

interface StepperContext {
	flow?: 'blueprint' | 'backup' | 'create';
	steps: StepperStep[];
	isVisible?: boolean;
	actionButton?: {
		label: string;
		isVisible: boolean;
	};
	onSubmit?: () => void;
	canSubmit?: boolean;
}

export function useStepper( config?: StepperConfig ): StepperContext {
	const { __ } = useI18n();
	const { location } = useNavigator();

	const stepperConfig = useMemo( (): StepperContext | null => {
		const blueprintSteps: StepperStep[] = [
			{ id: 'choose-blueprint', label: __( 'Choose blueprint' ), path: '/blueprint' },
			{ id: 'site-details', label: __( 'Site name & details' ), path: '/blueprint/create' },
		];

		const backupSteps: StepperStep[] = [
			{ id: 'select-file', label: __( 'Select or drop a file' ), path: '/backup' },
			{ id: 'add-site', label: __( 'Site name & details' ), path: '/backup/create' },
		];

		const createSteps: StepperStep[] = [
			{ id: 'create-site', label: __( 'Site name & details' ), path: '/create' },
		];

		if ( location.path?.startsWith( '/blueprint' ) ) {
			return {
				flow: 'blueprint',
				steps: blueprintSteps,
			};
		}

		if ( location.path?.startsWith( '/backup' ) ) {
			return {
				flow: 'backup',
				steps: backupSteps,
			};
		}

		if ( location.path === '/create' ) {
			return {
				flow: 'create',
				steps: createSteps,
			};
		}

		return null;
	}, [ location.path, __ ] );

	const steps = useMemo( (): StepperStep[] => {
		if ( ! stepperConfig ) {
			return [];
		}

		return stepperConfig.steps.map( ( step ): StepperStep => {
			let status: 'completed' | 'current' | 'pending' = 'pending';

			// Determine status based on current path
			const currentStepIndex = stepperConfig.steps.findIndex( ( s ) => location.path === s.path );
			const stepIndex = stepperConfig.steps.indexOf( step );

			if ( stepIndex < currentStepIndex ) {
				status = 'completed';
			} else if ( stepIndex === currentStepIndex ) {
				status = 'current';
			}

			return {
				id: step.id,
				label: step.label,
				status,
			};
		} );
	}, [ stepperConfig, location.path ] );

	// Only show stepper when we're in a multi-step flow
	const isVisible = stepperConfig !== null && location.path !== '/';

	// Determine action button configuration based on current path
	const actionButton = useMemo( () => {
		if ( ! location.path || location.path === '/' ) {
			return undefined;
		}

		switch ( location.path ) {
			case '/blueprint':
			case '/backup':
				return {
					label: __( 'Continue' ),
					isVisible: true,
				};
			case '/create':
			case '/blueprint/create':
			case '/backup/create':
				return {
					label: __( 'Add site' ),
					isVisible: true,
				};
			default:
				return undefined;
		}
	}, [ location.path, __ ] );

	// Determine the submit handler based on current path
	const onSubmit = useCallback( () => {
		if ( ! location.path ) return;

		switch ( location.path ) {
			case '/blueprint':
				config?.onBlueprintContinue?.();
				break;
			case '/backup':
				config?.onBackupContinue?.();
				break;
			case '/create':
			case '/blueprint/create':
			case '/backup/create':
				config?.onCreateSubmit?.( { preventDefault: () => {} } as FormEvent );
				break;
		}
	}, [ location.path, config ] );

	// Determine if submission is allowed based on current path
	const canSubmit = useMemo( () => {
		if ( ! location.path ) return false;

		switch ( location.path ) {
			case '/blueprint':
				return config?.canSubmitBlueprint ?? false;
			case '/backup':
				return config?.canSubmitBackup ?? false;
			case '/create':
			case '/blueprint/create':
			case '/backup/create':
				return config?.canSubmitCreate ?? false;
			default:
				return false;
		}
	}, [ location.path, config ] );

	return {
		steps,
		isVisible,
		actionButton,
		onSubmit,
		canSubmit,
	};
}
