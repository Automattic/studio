import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { persistPromise } from '@/data/core';
import { createIpcConnector } from '@/data/core/connectors/ipc';

async function bootstrap() {
	const connector = createIpcConnector();

	await persistPromise;

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<App connector={ connector } />
		</StrictMode>
	);
}

void bootstrap();
