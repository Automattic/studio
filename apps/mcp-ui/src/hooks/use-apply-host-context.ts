import { useEffect } from 'react';
import { useHostState } from './use-host-state';

const SIDES = [ 'top', 'right', 'bottom', 'left' ] as const;

// The host's theme, display mode and safe areas.
export function useApplyHostContext() {
	const { context } = useHostState();
	const { theme, displayMode, safeAreaInsets } = context;

	useEffect( () => {
		const root = document.documentElement;
		if ( theme === 'light' || theme === 'dark' ) {
			root.dataset.theme = theme;
		}
		if ( displayMode ) {
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
}
