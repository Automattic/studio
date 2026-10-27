import { createContext, useContext } from 'react';

// True whenever the sidebar isn't docked beside the content: collapsed, or
// shown as an overlay on a small window. Headers then carry the sidebar toggle.
export const SidebarCollapsedContext = createContext( false );

export function useSidebarCollapsed(): boolean {
	return useContext( SidebarCollapsedContext );
}

// Whether the sidebar is showing, docked or as an overlay.
export const SidebarOpenContext = createContext( true );

export function useSidebarOpen(): boolean {
	return useContext( SidebarOpenContext );
}

export const SidebarToggleContext = createContext< () => void >( () => {} );

export function useToggleSidebar(): () => void {
	return useContext( SidebarToggleContext );
}

export const SidebarHoverContext = createContext( {
	peek: false,
	onEnter: () => {},
	onLeave: () => {},
} );

export function useSidebarHover() {
	return useContext( SidebarHoverContext );
}
