import { useCallback, useState } from 'react';
import type { SetupSource } from './context';

export function useSetupSource() {
	const [ source, setSource ] = useState< SetupSource >( { type: 'blank' } );
	const [ folderResetKey, setFolderResetKey ] = useState( 0 );
	const removeFolder = useCallback( () => {
		setSource( { type: 'blank' } );
		setFolderResetKey( ( key ) => key + 1 );
	}, [] );
	return { source, setSource, folderResetKey, removeFolder };
}
