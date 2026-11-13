import { useCallback, useState } from 'react';
import type { SetupSource } from './context';
import type { SelectedSiteFolder } from '@/data/core';

export function useSetupSource() {
	const [ source, setSource ] = useState< SetupSource >( { type: 'blank' } );
	const [ folderResetKey, setFolderResetKey ] = useState( 0 );
	const adoptFolder = useCallback( ( folder: SelectedSiteFolder ) => {
		setSource( ( current ) =>
			current.type === 'blank' ||
			( current.type === 'folder' && current.folder.path !== folder.path )
				? { type: 'folder', folder }
				: current
		);
	}, [] );
	const removeFolder = useCallback( () => {
		setSource( { type: 'blank' } );
		setFolderResetKey( ( key ) => key + 1 );
	}, [] );
	return { source, setSource, adoptFolder, folderResetKey, removeFolder };
}
