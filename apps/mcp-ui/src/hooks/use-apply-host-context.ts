import { useEffect } from 'react';
import { useHostState } from './use-host-state';

const SIDES = [ 'top', 'right', 'bottom', 'left' ] as const;

// The host's theme, display mode, safe areas and style variables.
export function useApplyHostContext() {
	const { context } = useHostState();
	const { theme, displayMode, safeAreaInsets, styles } = context;

	useEffect( () => {
		const root = document.documentElement;
		if ( theme === 'light' || theme === 'dark' ) {
			root.dataset.theme = theme;
		}
		if ( displayMode && [ 'inline', 'fullscreen', 'pip' ].includes( displayMode ) ) {
			root.dataset.displayMode = displayMode;
		}
	}, [ theme, displayMode ] );

	useEffect( () => {
		for ( const side of SIDES ) {
			const inset = Number( safeAreaInsets?.[ side ] );
			document.documentElement.style.setProperty(
				`--app-safe-${ side }`,
				`${ inset > 0 ? inset : 0 }px`
			);
		}
	}, [ safeAreaInsets ] );

	useEffect( () => {
		const root = document.documentElement;
		const names = Object.entries( styles?.variables ?? {} )
			.filter( ( [ name, value ] ) => name.startsWith( '--' ) && typeof value === 'string' )
			.map( ( [ name, value ] ) => {
				root.style.setProperty( name, value );
				return name;
			} );
		return () => names.forEach( ( name ) => root.style.removeProperty( name ) );
	}, [ styles ] );
}
