import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { OnboardingGuide } from './index';
import type { GuideDefinition } from '@/data/onboarding/guide';
import type { ReactNode } from 'react';

export type GuideEndReason = 'completed' | 'dismissed';

interface OpenGuideOptions {
	onEnd?: ( reason: GuideEndReason ) => void;
}

interface OnboardingGuideApi {
	isOpen: boolean;
	openGuide( guide: GuideDefinition, options?: OpenGuideOptions ): void;
	close( reason: GuideEndReason ): void;
}

export type OpenGuide = OnboardingGuideApi[ 'openGuide' ];

const OnboardingGuideContext = createContext< OnboardingGuideApi | null >( null );

export function OnboardingGuideProvider( { children }: { children: ReactNode } ) {
	const [ guide, setGuide ] = useState< GuideDefinition | null >( null );
	const onEndRef = useRef< ( ( reason: GuideEndReason ) => void ) | null >( null );

	const openGuide = useCallback( ( next: GuideDefinition, options?: OpenGuideOptions ) => {
		onEndRef.current = options?.onEnd ?? null;
		setGuide( next );
	}, [] );

	const close = useCallback( ( reason: GuideEndReason ) => {
		const callback = onEndRef.current;
		onEndRef.current = null;
		setGuide( null );
		callback?.( reason );
	}, [] );

	const api = useMemo< OnboardingGuideApi >(
		() => ( { isOpen: guide !== null, openGuide, close } ),
		[ guide, openGuide, close ]
	);

	return (
		<OnboardingGuideContext.Provider value={ api }>
			{ children }
			{ guide ? (
				<OnboardingGuide
					guide={ guide }
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
