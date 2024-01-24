import { useState } from 'react';
import { useIpcListener } from '../hooks/use-ipc-listener';

export default function CrashTester() {
	const [ renderFailure, setRenderFailure ] = useState( false );

	// test-renderer-failure message sent by "Test Render Failure" menu item
	useIpcListener( 'test-render-failure', () => {
		setRenderFailure( true );
	} );

	if ( renderFailure ) {
		throw new Error( 'Error occurred while rendering for testing purposes' );
	}

	return null;
}
