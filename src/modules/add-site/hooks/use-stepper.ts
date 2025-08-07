import { useNavigator } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

interface StepperStep {
	id: string;
	label: string;
	status: 'completed' | 'current' | 'pending';
}

interface StepperContext {
	steps: StepperStep[];
	isVisible: boolean;
	actionButton?: {
		label: string;
		isVisible: boolean;
	};
}

export function useStepper(): StepperContext {
	const { __ } = useI18n();
	const { location } = useNavigator();

	const stepperConfig = useMemo( () => {
		const blueprintSteps = [
			{ id: 'choose-blueprint', label: __( 'Choose blueprint' ), path: '/blueprint' },
			{ id: 'site-details', label: __( 'Site name & details' ), path: '/blueprint/create' },
		];

		const backupSteps = [
			{ id: 'select-file', label: __( 'Select or drop a file' ), path: '/backup' },
			{ id: 'add-site', label: __( 'Site name & details' ), path: '/backup/create' },
		];

		const createSteps = [
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

	const steps = useMemo( () => {
		if ( ! stepperConfig ) {
			return [];
		}

		return stepperConfig.steps.map( ( step ) => {
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

	return {
		steps,
		isVisible,
		actionButton,
	};
}
