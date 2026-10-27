import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { replaceOpenDialogs } from '@/lib/ui';
import { getWhatsNewContent, WHATS_NEW_VERSION } from './content';
import { WhatsNewDialog } from './index';
import type { ReactNode } from 'react';

const WhatsNewContext = createContext< { isOpen: boolean; open: () => boolean } | null >( null );

export function WhatsNewProvider( { children }: { children: ReactNode } ) {
	const [ isOpen, setOpen ] = useState( false );
	const { data: hints } = useOnboardingHints();
	const { mutate: setHints } = useSetOnboardingHints();
	const open = useCallback( () => replaceOpenDialogs( () => setOpen( true ) ), [] );
	const close = () => {
		setHints( {
			whatsNewSeenVersion: Math.max( hints?.whatsNewSeenVersion ?? 0, WHATS_NEW_VERSION ),
		} );
		setOpen( false );
	};
	return (
		<WhatsNewContext.Provider value={ { isOpen, open } }>
			{ children }
			{ isOpen && <WhatsNewDialog content={ getWhatsNewContent() } onClose={ close } /> }
		</WhatsNewContext.Provider>
	);
}

export function useWhatsNew() {
	const context = useContext( WhatsNewContext );
	if ( ! context ) throw new Error( 'useWhatsNew must be used within a WhatsNewProvider' );
	return context;
}

export function useOpenWhatsNew() {
	return useWhatsNew().open;
}

export function useWhatsNewReplay(): void {
	const connector = useConnector();
	const open = useOpenWhatsNew();
	useEffect( () => connector.onShowWhatsNew( open ), [ connector, open ] );
}
