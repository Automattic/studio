import { PanelRightIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { createContext, useContext } from 'react';

export const PanelCommandContext = createContext< {
	siteId?: string;
	toggle: () => void;
	chatHidden: boolean;
	toggleChat?: () => void;
} | null >( null );

export function usePanelCommand( siteId?: string ) {
	const panel = useContext( PanelCommandContext );
	if ( ! panel || ! siteId || panel.siteId !== siteId ) return undefined;

	return {
		name: 'panel',
		displayName: __( 'Toggle panel' ),
		description: __( 'Show or hide the panel beside your chat.' ),
		icon: PanelRightIcon,
		run: panel.toggle,
	};
}
