import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import type { SetupSource } from './context';
import type { SelectedSiteFolder } from '@/data/core';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';

export function useSetupSource() {
	const connector = useConnector();
	const [ source, updateSource ] = useState< SetupSource >( { type: 'blank' } );
	const [ folderResetKey, setFolderResetKey ] = useState( 0 );
	const blueprint = useRef< SelectedBlueprint | undefined >( undefined );
	const transferred = useRef( false );
	const lifecycle = useRef( { generation: 0 } );
	const cleanup = useCallback(
		( selected: SelectedBlueprint | undefined ) => {
			if ( selected?.tempDir && ! transferred.current ) {
				void connector.cleanupBlueprintTempDir( selected.tempDir ).catch( () => undefined );
			}
		},
		[ connector ]
	);
	const setSource = useCallback(
		( next: SetupSource ) => {
			const selected = next.type === 'blueprint' ? next.blueprint : undefined;
			if ( selected !== blueprint.current ) {
				cleanup( blueprint.current );
				blueprint.current = selected;
				transferred.current = false;
			}
			updateSource( next );
		},
		[ cleanup ]
	);
	const adoptFolder = useCallback( ( folder: SelectedSiteFolder ) => {
		updateSource( ( current ) =>
			current.type === 'blank' ||
			( current.type === 'folder' && current.folder.path !== folder.path )
				? { type: 'folder', folder }
				: current
		);
	}, [] );
	useEffect( () => {
		const current = lifecycle.current;
		const generation = ++current.generation;
		return () => {
			// Strict Mode replays setup; release files only after a real unmount.
			queueMicrotask( () => {
				if ( generation === current.generation ) cleanup( blueprint.current );
			} );
		};
	}, [ cleanup ] );
	const setBlueprintTransferred = useCallback( ( value: boolean ) => {
		transferred.current = value;
	}, [] );
	const removeFolder = useCallback( () => {
		setSource( { type: 'blank' } );
		setFolderResetKey( ( key ) => key + 1 );
	}, [ setSource ] );
	return { source, setSource, adoptFolder, setBlueprintTransferred, folderResetKey, removeFolder };
}
