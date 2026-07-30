import { useNavigator } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useMemo } from 'react';

interface StepperConfig {
	onBlueprintContinue?: () => void;
	onBlueprintDeeplinkContinue?: () => void;
	onPullRemoteContinue?: () => void;
	onCreateSubmit?: ( event: FormEvent ) => void;
	canSubmitBlueprint?: boolean;
	canSubmitBlueprintDeeplink?: boolean;
	canSubmitPullRemote?: boolean;
	canSubmitCreate?: boolean;
}

interface UseStepper {
	isVisible: boolean;
	actionButton?: {
		label: string;
		isVisible: boolean;
	};
	onSubmit: () => void;
	canSubmit: boolean;
}

export function useStepper( config?: StepperConfig ): UseStepper {
	const { __ } = useI18n();
	const { location } = useNavigator();

	const isVisible = location.path !== '/' && location.path !== undefined;

	const actionButton = useMemo( () => {
		if ( ! location.path || location.path === '/' ) {
			return undefined;
		}

		switch ( location.path ) {
			case '/new':
			case '/blueprint/deeplink':
				return {
					label: __( 'Continue' ),
					isVisible: true,
				};
			case '/pullRemote':
			case '/new/create':
			case '/blueprint/deeplink/create':
			case '/backup/create':
				return {
					label: __( 'Add site' ),
					isVisible: true,
				};
			default:
				return undefined;
		}
	}, [ location.path, __ ] );

	const onSubmit = useCallback( () => {
		if ( ! location.path ) return;

		switch ( location.path ) {
			case '/new':
				config?.onBlueprintContinue?.();
				break;
			case '/blueprint/deeplink':
				config?.onBlueprintDeeplinkContinue?.();
				break;
			case '/pullRemote':
				config?.onPullRemoteContinue?.();
				break;
			case '/new/create':
			case '/blueprint/deeplink/create':
			case '/backup/create':
				config?.onCreateSubmit?.( { preventDefault: () => {} } as FormEvent );
				break;
		}
	}, [ location.path, config ] );

	const canSubmit = useMemo( () => {
		if ( ! location.path ) return false;

		switch ( location.path ) {
			case '/new':
				return config?.canSubmitBlueprint ?? false;
			case '/blueprint/deeplink':
				return config?.canSubmitBlueprintDeeplink ?? false;
			case '/pullRemote':
				return config?.canSubmitPullRemote ?? false;
			case '/new/create':
			case '/blueprint/deeplink/create':
			case '/backup/create':
				return config?.canSubmitCreate ?? false;
			default:
				return false;
		}
	}, [ location.path, config ] );

	return {
		isVisible,
		actionButton,
		onSubmit,
		canSubmit,
	};
}
