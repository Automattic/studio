import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { initialize } from '@/data/bridge';

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App />
	</StrictMode>
);

void initialize();
