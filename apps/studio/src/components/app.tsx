import { useCallback, useEffect, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { DevController } from 'src/components/new-ui/dev-controller';
import { PanelLayout, togglePanel } from 'src/components/new-ui/panel-layout';
import WindowsTitlebar from 'src/components/windows-titlebar';
import { isWindows } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import 'src/index.css';

export default function App() {
	const navPanelRef = usePanelRef();
	const secondaryPanelRef = usePanelRef();
	const [ navCollapsed, setNavCollapsed ] = useState( false );

	// Re-render when dev controller changes platform
	const [ , forceRender ] = useState( 0 );
	useEffect( () => {
		const handler = () => forceRender( ( n ) => n + 1 );
		window.addEventListener( 'dev-platform-change', handler );
		return () => window.removeEventListener( 'dev-platform-change', handler );
	}, [] );

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding: false } );
	}, [] );

	const toggleNav = useCallback( () => {
		togglePanel( navPanelRef.current, ( c ) => setNavCollapsed( c ) );
	}, [ navPanelRef ] );

	const handleKeyDown = useCallback(
		( e: KeyboardEvent ) => {
			const mod = e.metaKey || e.ctrlKey;
			if ( ! mod || e.key.toLowerCase() !== 'b' ) {
				return;
			}
			e.preventDefault();
			if ( e.shiftKey ) {
				togglePanel( secondaryPanelRef.current );
			} else {
				toggleNav();
			}
		},
		[ secondaryPanelRef, toggleNav ]
	);

	useEffect( () => {
		window.addEventListener( 'keydown', handleKeyDown );
		return () => window.removeEventListener( 'keydown', handleKeyDown );
	}, [ handleKeyDown ] );

	return (
		<div className="h-screen flex flex-col bg-chrome">
			{ isWindows() && <WindowsTitlebar className="h-titlebar-win flex-shrink-0" /> }

			<PanelLayout
				navPanelRef={ navPanelRef }
				secondaryPanelRef={ secondaryPanelRef }
				navCollapsed={ navCollapsed }
				setNavCollapsed={ setNavCollapsed }
				onToggleNav={ toggleNav }
			/>
			<DevController />
		</div>
	);
}
