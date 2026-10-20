import { createContext, useContext } from 'react';

export const SidebarCollapsedContext = createContext( false );

export function useSidebarCollapsed(): boolean {
	return useContext( SidebarCollapsedContext );
}

export const SidebarToggleContext = createContext< () => void >( () => {} );

export function useToggleSidebar(): () => void {
	return useContext( SidebarToggleContext );
}
