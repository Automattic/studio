import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useActiveStudioExtensions } from '../hooks/use-active-studio-extensions';
import type { StudioExtensionMainContentPanel } from '../types';

function filterPanelIds( current: Set< string >, stablePanelIds: Set< string > ) {
	const next = new Set( [ ...current ].filter( ( panelId ) => stablePanelIds.has( panelId ) ) );
	return next.size === current.size ? current : next;
}

function MainContentPanel( {
	onPanelStateChange,
	panel,
}: {
	onPanelStateChange: ( panelId: string, isActive: boolean, isMounted: boolean ) => void;
	panel: StudioExtensionMainContentPanel;
} ) {
	const isActive = panel.useIsActive();
	const Panel = panel.component;

	useEffect( () => {
		onPanelStateChange( panel.id, isActive, true );
		return () => onPanelStateChange( panel.id, false, false );
	}, [ isActive, onPanelStateChange, panel.id ] );

	return isActive ? <Panel /> : null;
}

export function useHasActiveStudioExtensions() {
	const { extensions, isLoading } = useActiveStudioExtensions();
	return {
		isLoading,
		hasActiveExtensions: extensions.length > 0,
	};
}

export function StudioExtensionMainContent( { fallback }: { fallback: ReactNode } ) {
	const { extensions } = useActiveStudioExtensions();
	const panels = useMemo(
		() => extensions.flatMap( ( extension ) => extension.mainContentPanels ?? [] ),
		[ extensions ]
	);
	const [ activePanelIds, setActivePanelIds ] = useState< Set< string > >( new Set() );
	const [ mountedPanelIds, setMountedPanelIds ] = useState< Set< string > >( new Set() );

	const handlePanelStateChange = useCallback(
		( panelId: string, isActive: boolean, isMounted: boolean ) => {
			setMountedPanelIds( ( current ) => {
				const next = new Set( current );
				if ( isMounted ) {
					next.add( panelId );
				} else {
					next.delete( panelId );
				}
				return next;
			} );

			setActivePanelIds( ( current ) => {
				const next = new Set( current );
				if ( isActive ) {
					next.add( panelId );
				} else {
					next.delete( panelId );
				}
				return next;
			} );
		},
		[]
	);

	const shouldRenderFallback =
		panels.length === 0 || ( mountedPanelIds.size === panels.length && activePanelIds.size === 0 );

	const stablePanels = useMemo( () => new Set( panels.map( ( panel ) => panel.id ) ), [ panels ] );

	useEffect( () => {
		setMountedPanelIds( ( current ) => filterPanelIds( current, stablePanels ) );
		setActivePanelIds( ( current ) => filterPanelIds( current, stablePanels ) );
	}, [ stablePanels ] );

	return (
		<>
			{ panels.map( ( panel ) => (
				<MainContentPanel
					key={ panel.id }
					panel={ panel }
					onPanelStateChange={ handlePanelStateChange }
				/>
			) ) }
			{ shouldRenderFallback && fallback }
		</>
	);
}
