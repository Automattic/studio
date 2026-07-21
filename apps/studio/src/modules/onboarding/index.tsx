import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { StudioLogo } from 'src/components/studio-logo';
import { useAuth } from 'src/hooks/use-auth';
import { OnboardingConnectToWpcom } from 'src/modules/onboarding/components/connect-to-wpcom';
import { useAppDispatch } from 'src/stores';
import { useSaveLastSeenVersionMutation } from 'src/stores/app-version-api';
import { useSaveAnalyticsEnabledMutation } from 'src/stores/installed-apps-api';
import { saveOnboardingStatus } from 'src/stores/onboarding-slice';

const GradientBox = () => {
	const { __ } = useI18n();
	return (
		<div
			aria-label={ __( 'Imagine, Create, Design, Code, Build' ) }
			className="gap-0 flex flex-col font-normal text-[42px] leading-[42px] text-white"
		>
			<div className="flex flex-col gap-1 relative self-stretch pb-1">
				<div className="absolute inset-0 bg-gradient-to-b from-[var(--color-frame-theme)] to-[var(--color-frame-theme)]/60"></div>
				<p>{ __( 'Imagine' ) }</p>
				<p>{ __( 'Create' ) }</p>
				<p>{ __( 'Design' ) }</p>
				<p>{ __( 'Code' ) }</p>
			</div>
			<div className="text-white tracking-[-0.84px] flex justify-between items-baseline self-stretch">
				<p>{ __( 'Build' ) }</p>
			</div>
		</div>
	);
};

export function Onboarding() {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { isAuthenticated } = useAuth();
	const [ saveLastSeenVersion ] = useSaveLastSeenVersionMutation();
	const [ saveAnalyticsEnabled ] = useSaveAnalyticsEnabledMutation();

	// Analytics is opt-out (default ON). Persist the choice as soon as the user flips the toggle, so it
	// sticks however onboarding ends — Skip, login (auto-skip), or just closing the window.
	const [ analyticsEnabled, setAnalyticsEnabled ] = useState( true );
	const handleAnalyticsEnabledChange = useCallback(
		( enabled: boolean ) => {
			setAnalyticsEnabled( enabled );
			void saveAnalyticsEnabled( enabled );
		},
		[ saveAnalyticsEnabled ]
	);

	const handleSkip = useCallback( async () => {
		// Save current app version to prevent What's New from showing for new users
		await saveLastSeenVersion( window.appGlobals.appVersion );

		await dispatch( saveOnboardingStatus( true ) );
	}, [ dispatch, saveLastSeenVersion ] );

	useEffect( () => {
		if ( isAuthenticated ) {
			void handleSkip();
		}
	}, [ isAuthenticated, handleSkip ] );

	return (
		<div className="flex flex-row flex-grow" data-testid="onboarding">
			<div className="w-1/2 bg-frame-theme pb-[50px] pt-[46px] px-[50px] flex flex-col justify-between">
				<div className="flex justify-start items-center gap-1 mt-6">
					<StudioLogo className="fill-white" />
				</div>
				<GradientBox />
			</div>

			<div className="w-1/2 bg-frame text-frame-text p-[50px] flex flex-col relative overflow-y-auto app-no-drag-region">
				<div className="flex flex-col justify-center items-center flex-[1_0_0%] gap-8">
					<OnboardingConnectToWpcom
						onSkip={ handleSkip }
						analyticsEnabled={ analyticsEnabled }
						onAnalyticsEnabledChange={ handleAnalyticsEnabledChange }
					/>
				</div>
			</div>
		</div>
	);
}
