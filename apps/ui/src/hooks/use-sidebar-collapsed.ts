import { createContext, useContext } from 'react';

export const SidebarCollapsedContext = createContext( false );

export function useSidebarCollapsed(): boolean {
	return useContext( SidebarCollapsedContext );
}
