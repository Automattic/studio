import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { persistPromise } from '@/data/core';
import { createIpcConnector } from '@/data/core/connectors/ipc';
import { applyLocale } from '@/lib/apply-locale';

async function bootstrap() {
	const connector = createIpcConnector();

	await Promise.all( [ connector.init?.(), applyLocale( connector ), persistPromise ] );

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<App connector={ connector } />
		</StrictMode>
	);
}

void bootstrap();
