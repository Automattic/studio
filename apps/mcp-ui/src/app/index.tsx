import { Library } from '@/components/library';
import { AppProviders } from './app-providers';
import type { Connector } from '@/data/core';
import '@/index.css';

export function App( { connector }: { connector: Connector } ) {
	return (
		<AppProviders connector={ connector }>
			<Library />
		</AppProviders>
	);
}
