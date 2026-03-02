import { useNavigator } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useMemo } from 'react';
import { type AddSiteFlowType } from '../components/options';

interface StepperStep {
	id: string;
	label: string;
	status?: 'completed' | 'current' | 'pending';
	path?: string;
	isClickable?: boolean;
	isCurrent?: boolean;
	isCompleted?: boolean;
	onClick?: () => void;
}

interface StepperConfig {
	onBlueprintContinue?: () => void;
	onBlueprintDetailsContinue?: () => void;
	onBlueprintDeeplinkContinue?: () => void;
	onBackupContinue?: () => void;
	onPullRemoteContinue?: () => void;
	onCreateSubmit?: ( event: FormEvent ) => void;
	onAddonSubmit?: () => void;
	canSubmitBlueprint?: boolean;
	canSubmitBlueprintDetails?: boolean;
	canSubmitBlueprintDeeplink?: boolean;
	canSubmitBackup?: boolean;
	canSubmitPullRemote?: boolean;
	canSubmitCreate?: boolean;
	canSubmitAddon?: boolean;
}

interface StepperContext {
	flow: AddSiteFlowType;
	steps: StepperStep[];
}

interface UseStepper {
	steps: StepperStep[];
	isVisible: boolean;
	actionButton?: {
		label: string;
		isVisible: boolean;
	};
	onSubmit: () => void;
	canSubmit: boolean;
	goTo: ( path: string ) => void;
}

export function useStepper( config?: StepperConfig ): UseStepper {
	const { __ } = useI18n();
	const { location, goTo } = useNavigator();

	const stepperContext = useMemo( (): StepperContext | null => {
		const blueprintSteps: StepperStep[] = [
			{ id: 'choose-blueprint', label: __( 'Choose Blueprint' ), path: '/blueprint/select' },
			{
				id: 'blueprint-details',
				label: __( 'Blueprint details' ),
				path: '/blueprint/select/details',
			},
			{ id: 'site-details', label: __( 'Site name & details' ), path: '/blueprint/select/create' },
		];

		const backupSteps: StepperStep[] = [
			{ id: 'select-file', label: __( 'Select or drop a file' ), path: '/backup' },
			{ id: 'add-site', label: __( 'Site name & details' ), path: '/backup/create' },
		];

		const createSteps: StepperStep[] = [
			{ id: 'create-site', label: __( 'Site name & details' ), path: '/create' },
		];

		const pullRemoteSteps: StepperStep[] = [
			{ id: 'select-remote-site', label: __( 'Select a remote site' ), path: '/pullRemote' },
			{ id: 'site-details', label: __( 'Site name & details' ), path: '/pullRemote/create' },
		];

		const blueprintDeeplinkSteps: StepperStep[] = [
			{ id: 'blueprint-selected', label: __( 'Blueprint details' ), path: '/blueprint/deeplink' },
			{
				id: 'site-details',
				label: __( 'Site name & details' ),
				path: '/blueprint/deeplink/create',
			},
		];

		if ( location.path?.startsWith( '/blueprint/deeplink' ) ) {
			return {
				flow: 'blueprintDeeplink',
				steps: blueprintDeeplinkSteps,
			};
		}

		if ( location.path?.startsWith( '/blueprint/select' ) ) {
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

		if ( location.path?.startsWith( '/pullRemote' ) ) {
			return {
				flow: 'pullRemote',
				steps: pullRemoteSteps,
			};
		}

		if ( location.path === '/create' ) {
			return {
				flow: 'create',
				steps: createSteps,
			};
		}

		if ( location.path?.startsWith( '/addon-' ) ) {
			return {
				flow: location.path.slice( 1 ) as AddSiteFlowType, // e.g. 'addon-vip'
				steps: [ { id: 'addon-create', label: __( 'Site details' ), path: location.path } ],
			};
		}

		return null;
	}, [ location.path, __ ] );

	const steps = useMemo( (): StepperStep[] => {
		if ( ! stepperContext ) {
			return [];
		}

		return stepperContext.steps.map( ( step ): StepperStep => {
			let status: 'completed' | 'current' | 'pending' = 'pending';

			// Determine status based on current path
			const currentStepIndex = stepperContext.steps.findIndex( ( s ) => location.path === s.path );
			const stepIndex = stepperContext.steps.indexOf( step );

			if ( stepIndex < currentStepIndex ) {
				status = 'completed';
			} else if ( stepIndex === currentStepIndex ) {
				status = 'current';
			}

			const isCurrent = status === 'current';
			const isCompleted = status === 'completed';
			const isClickable = isCompleted && Boolean( step.path );

			const onClick = () => {
				if ( isClickable && step.path ) {
					goTo( step.path );
				}
			};

			return {
				id: step.id,
				label: step.label,
				status,
				path: step.path,
				isClickable,
				isCurrent,
				isCompleted,
				onClick,
			};
		} );
	}, [ stepperContext, location.path, goTo ] );

	// Only show stepper when we're in a multi-step flow
	const isVisible = stepperContext !== null && location.path !== '/';

	// Determine action button configuration based on current path
	const actionButton = useMemo( () => {
		if ( ! location.path || location.path === '/' ) {
			return undefined;
		}

		if ( location.path.startsWith( '/addon-' ) ) {
			return {
				label: __( 'Add site' ),
				isVisible: true,
			};
		}

		switch ( location.path ) {
			case '/blueprint/select':
			case '/blueprint/select/details':
			case '/blueprint/deeplink':
			case '/backup':
			case '/pullRemote':
				return {
					label: __( 'Continue' ),
					isVisible: true,
				};
			case '/create':
			case '/blueprint/select/create':
			case '/blueprint/deeplink/create':
			case '/backup/create':
			case '/pullRemote/create':
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

		if ( location.path.startsWith( '/addon-' ) ) {
			config?.onAddonSubmit?.();
			return;
		}

		switch ( location.path ) {
			case '/blueprint/select':
				config?.onBlueprintContinue?.();
				break;
			case '/blueprint/select/details':
				config?.onBlueprintDetailsContinue?.();
				break;
			case '/blueprint/deeplink':
				config?.onBlueprintDeeplinkContinue?.();
				break;
			case '/backup':
				config?.onBackupContinue?.();
				break;
			case '/pullRemote':
				config?.onPullRemoteContinue?.();
				break;
			case '/create':
			case '/blueprint/select/create':
			case '/blueprint/deeplink/create':
			case '/backup/create':
			case '/pullRemote/create':
				config?.onCreateSubmit?.( { preventDefault: () => {} } as FormEvent );
				break;
		}
	}, [ location.path, config ] );

	// Determine if submission is allowed based on current path
	const canSubmit = useMemo( () => {
		if ( ! location.path ) return false;

		if ( location.path.startsWith( '/addon-' ) ) {
			return config?.canSubmitAddon ?? false;
		}

		switch ( location.path ) {
			case '/blueprint/select':
				return config?.canSubmitBlueprint ?? false;
			case '/blueprint/select/details':
				return config?.canSubmitBlueprintDetails ?? false;
			case '/blueprint/deeplink':
				return config?.canSubmitBlueprintDeeplink ?? false;
			case '/backup':
				return config?.canSubmitBackup ?? false;
			case '/pullRemote':
				return config?.canSubmitPullRemote ?? false;
			case '/create':
			case '/blueprint/select/create':
			case '/blueprint/deeplink/create':
			case '/backup/create':
			case '/pullRemote/create':
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
		goTo,
	};
}
