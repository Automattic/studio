import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Library } from '@/components/library';
import { initialize } from '@/data/bridge';
import { queryClient } from '@/data/query-client';
import '@/index.css';

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<QueryClientProvider client={ queryClient }>
			<Library />
		</QueryClientProvider>
	</StrictMode>
);

void initialize();
