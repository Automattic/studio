import { AppProviders } from '@/app/app-providers';
import { StudioApp } from '@/surfaces/shell/app';
import '@wordpress/components/build-style/style.css';
import '@wordpress/dataviews/build-style/style.css';
import '@wordpress/theme/design-tokens.css';
import '@/index.css';
import type { Connector } from '@/data/core';

interface AppProps {
	connector: Connector;
}

export function App( { connector }: AppProps ) {
	return (
		<AppProviders connector={ connector }>
			<StudioApp connector={ connector } />
		</AppProviders>
	);
}
