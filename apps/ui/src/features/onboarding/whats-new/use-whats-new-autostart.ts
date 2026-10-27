import { useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { WHATS_NEW_VERSION } from './content';
import { useWhatsNew } from './use-whats-new';
import type { OnboardingHintsState } from '@/data/core';

interface AutostartInputs {
	siteCount: number;
	agenticReady: boolean;
	hints: OnboardingHintsState | undefined;
	dialogOpen: boolean;
	guideOpen: boolean;
	alreadyStarted: boolean;
}

export function shouldShowWhatsNew( input: AutostartInputs ): boolean {
	return (
		! input.alreadyStarted &&
		! input.guideOpen &&
		! input.dialogOpen &&
		input.siteCount > 0 &&
		input.agenticReady &&
		input.hints !== undefined &&
		( input.hints.whatsNewSeenVersion ?? 0 ) < WHATS_NEW_VERSION
	);
}

export function useWhatsNewAutostart(): void {
	const { data: sites } = useSites();
	const { isReady } = useAgenticFeatures();
	const { data: hints } = useOnboardingHints();
	const { welcome, settings, addSite } = useSearch( { strict: false } ) as {
		welcome?: true;
		settings?: string;
		addSite?: string;
	};
	const { isOpen, open } = useWhatsNew();
	const [ started, setStarted ] = useState( false );
	const eligible = shouldShowWhatsNew( {
		siteCount: sites?.length ?? 0,
		agenticReady: isReady,
		hints,
		dialogOpen: !! ( welcome || settings || addSite ),
		guideOpen: isOpen,
		alreadyStarted: started,
	} );
	useEffect( () => {
		if ( ! eligible ) return;
		const timer = setTimeout( () => {
			setStarted( open() );
		}, 500 );
		return () => clearTimeout( timer );
	}, [ eligible, open ] );
}
