import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface DeskActions {
	createChat: () => void;
	openCreateSite: () => void;
	openImportSite: () => void;
	openUserDashboard: () => void;
}

const DeskActionsContext = createContext< DeskActions | null >( null );

export function DeskActionsProvider( {
	actions,
	children,
}: {
	actions: DeskActions;
	children: ReactNode;
} ) {
	return <DeskActionsContext.Provider value={ actions }>{ children }</DeskActionsContext.Provider>;
}

export function useDeskActions() {
	const actions = useContext( DeskActionsContext );
	if ( ! actions ) {
		throw new Error( 'useDeskActions must be used inside DeskActionsProvider' );
	}
	return actions;
}
