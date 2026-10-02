import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { createMcpBridgeConnector } from '@/data/core/connectors/mcp-bridge';

const connector = createMcpBridgeConnector();

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App connector={ connector } />
	</StrictMode>
);

void connector.initialize();
