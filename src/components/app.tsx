import { useEffect, useState } from 'react';
import { getIpcApi } from '../get-ipc-api';
import { SiteDetailsProvider } from '../hooks/use-site-details';
import { SiteList } from './site-list';
import { CreateSiteButton } from './create-site-button';

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
			<SiteDetailsProvider>
				<h1>Welcome to your local-environment.</h1>
				{ ! pingResponse && <p>Waiting for response...</p> }
				{ pingResponse && <p>IPC response: { pingResponse }</p> }
				<CreateSiteButton />
				<SiteList />
			</SiteDetailsProvider>
		</div>
	);
}
