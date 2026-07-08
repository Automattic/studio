import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { getOrientationGuide } from '@/data/onboarding/orientation-guide';
import { OnboardingGuide } from './index';
import type { OrientationVariant } from '@/data/onboarding/orientation-guide';
import type { ReactNode } from 'react';

export type GuideEndReason = 'completed' | 'dismissed';

interface OpenGuideOptions {
	onEnd?: ( reason: GuideEndReason ) => void;
}

interface OnboardingGuideApi {
	isOpen: boolean;
	openGuide( variant: OrientationVariant, options?: OpenGuideOptions ): void;
	close( reason: GuideEndReason ): void;
}

export type OpenGuide = OnboardingGuideApi[ 'openGuide' ];

const OnboardingGuideContext = createContext< OnboardingGuideApi | null >( null );

export function OnboardingGuideProvider( { children }: { children: ReactNode } ) {
	const [ variant, setVariant ] = useState< OrientationVariant | null >( null );
	const onEndRef = useRef< ( ( reason: GuideEndReason ) => void ) | null >( null );

	const openGuide = useCallback( ( next: OrientationVariant, options?: OpenGuideOptions ) => {
		onEndRef.current = options?.onEnd ?? null;
		setVariant( next );
	}, [] );

	const close = useCallback( ( reason: GuideEndReason ) => {
		const callback = onEndRef.current;
		onEndRef.current = null;
		setVariant( null );
		callback?.( reason );
	}, [] );

	const api = useMemo< OnboardingGuideApi >(
		() => ( { isOpen: variant !== null, openGuide, close } ),
		[ variant, openGuide, close ]
	);

	return (
		<OnboardingGuideContext.Provider value={ api }>
			{ children }
			{ variant ? (
				<OnboardingGuide
					guide={ getOrientationGuide( variant ) }
					onComplete={ () => close( 'completed' ) }
					onDismiss={ () => close( 'dismissed' ) }
				/>
			) : null }
		</OnboardingGuideContext.Provider>
	);
}

export function useOnboardingGuide(): OnboardingGuideApi {
	const api = useContext( OnboardingGuideContext );
	if ( ! api ) {
		throw new Error( 'useOnboardingGuide must be used within an OnboardingGuideProvider' );
	}
	return api;
}
