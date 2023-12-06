import { useEffect, useState } from 'react';
import { getIpcApi } from '../get-ipc-api';

export default function App() {
	const [ pingResponse, setResponse ] = useState< string | null >( null );

	useEffect( () => {
		getIpcApi()
			.ping( 'pong' )
			.then( ( response ) => {
				setResponse( response );
			} );
	} );

	return (
		<div className="max-w-xl m-auto p-8">
			<h1>💖 Hello World!</h1>
			<p>Welcome to your local-environment.</p>
			{ ! pingResponse && <p>Waiting for response...</p> }
			{ pingResponse && <p>IPC response: { pingResponse }</p> }
		</div>
	);
}
