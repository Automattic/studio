import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { createMemoryHistory } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { createInMemoryConnector, makeSite } from '@/test/in-memory-connector';
import type { AppUpdateStatus } from '@/data/core';

const params = new URLSearchParams( window.location.search );
const scheme = params.get( 'scheme' ) === 'dark' ? 'dark' : 'light';
const currentVersion = '2.1.0';
const errorStatus: AppUpdateStatus = { state: 'error', currentVersion, reason: 'generic' };
const initialState = params.get( 'state' ) ?? 'error';
let updateStatus: AppUpdateStatus =
	initialState === 'error'
		? errorStatus
		: initialState === 'idle' || initialState === 'checking'
		? { state: initialState, currentVersion }
		: {
				state: initialState === 'ready' ? 'ready' : 'downloading',
				currentVersion,
				newVersion: '2.1.1',
		  };

function setStatus( next: AppUpdateStatus ) {
	updateStatus = next;
	connector.emit( 'onAppUpdateStatusChanged', updateStatus );
}

const connector = createInMemoryConnector(
	{
		user: { id: 1, email: '', displayName: 'Rich Tabor' },
		sites: [ makeSite( { name: 'My WordPress site', running: false } ) ],
		preferences: { colorScheme: scheme },
	},
	{
		getOnboardingCompleted: async () => true,
		getAppUpdateStatus: async () => updateStatus,
		checkForAppUpdates: async () => {
			setStatus( { state: 'checking', currentVersion } );
			window.setTimeout( () => {
				setStatus( { state: 'downloading', currentVersion, newVersion: '2.1.1' } );
				window.setTimeout(
					() =>
						setStatus(
							params.get( 'result' ) === 'error'
								? { ...errorStatus }
								: { state: 'ready', currentVersion, newVersion: '2.1.1' }
						),
					3000
				);
			}, 900 );
		},
		installAppUpdate: async () => new Promise< void >( () => {} ),
	}
);

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App connector={ connector } history={ createMemoryHistory() } />
	</StrictMode>
);
