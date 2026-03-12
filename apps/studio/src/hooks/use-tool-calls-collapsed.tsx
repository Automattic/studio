import { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface ToolCallCollapseContextType {
	isCollapsed: boolean;
	toggleCollapsed: () => void;
}

const ToolCallCollapseContext = createContext< ToolCallCollapseContextType >( {
	isCollapsed: false,
	toggleCollapsed: () => {},
} );

export function ToolCallCollapseProvider( { children }: { children: React.ReactNode } ) {
	const [ isCollapsed, setIsCollapsed ] = useState( false );

	const toggleCollapsed = useCallback( () => {
		setIsCollapsed( ( prev ) => ! prev );
	}, [] );

	useEffect( () => {
		const handleKeyDown = ( e: KeyboardEvent ) => {
			if ( e.ctrlKey && e.key === 'o' ) {
				e.preventDefault();
				toggleCollapsed();
			}
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => window.removeEventListener( 'keydown', handleKeyDown );
	}, [ toggleCollapsed ] );

	return (
		<ToolCallCollapseContext.Provider value={ { isCollapsed, toggleCollapsed } }>
			{ children }
		</ToolCallCollapseContext.Provider>
	);
}

export function useToolCallsCollapsed() {
	return useContext( ToolCallCollapseContext );
}
