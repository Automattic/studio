import { useCallback, useState } from 'react';

export type UiMode = 'classic' | 'desks';

const STUDIO_UI_MODE_PARAM = 'studio-ui-mode';
const DEFAULT_UI_MODE: UiMode = 'desks';

function readLaunchUiMode(): UiMode | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}

	try {
		const mode = new URLSearchParams( window.location.search ).get( STUDIO_UI_MODE_PARAM );
		if ( mode === 'desks' ) {
			return 'desks';
		}
		if ( mode === 'agentic' ) {
			return 'classic';
		}
	} catch {
		return undefined;
	}
}

function readInitialUiMode(): UiMode {
	return readLaunchUiMode() ?? DEFAULT_UI_MODE;
}

function resetRoute() {
	if ( typeof window === 'undefined' ) {
		return;
	}

	if ( window.location.protocol === 'file:' ) {
		if ( window.location.hash !== '#/' ) {
			window.history.replaceState( window.history.state, '', '#/' );
		}
		return;
	}

	if ( window.location.pathname !== '/' || window.location.search || window.location.hash ) {
		window.history.replaceState( window.history.state, '', '/' );
	}
}

export function useUiMode() {
	const [ mode, setModeState ] = useState< UiMode >( readInitialUiMode );

	const setMode = useCallback(
		( nextMode: UiMode ) => {
			if ( mode === nextMode ) {
				return;
			}

			setModeState( nextMode );
			resetRoute();
		},
		[ mode ]
	);

	return { mode, setMode };
}
