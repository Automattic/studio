import { __ } from '@wordpress/i18n';
import { createContext, useContext } from 'react';
import { SplitViewIcon } from '@/lib/icons';

export const PanelCommandContext = createContext< {
	siteId?: string;
	toggle: () => void;
} | null >( null );

export function usePanelCommand( siteId?: string ) {
	const panel = useContext( PanelCommandContext );
	if ( ! panel || ! siteId || panel.siteId !== siteId ) return undefined;

	return {
		name: 'panel',
		displayName: __( 'Toggle panel' ),
		description: __( 'Show or hide the panel beside your chat.' ),
		icon: SplitViewIcon,
		run: panel.toggle,
	};
}
