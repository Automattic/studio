import { useEffect } from 'react';
import { AppProviders } from '@/app/app-providers';
import { useUiMode } from '@/app/use-ui-mode';
import { ClassicUiApp } from '@/ui-classic/app';
import { DesksUiApp } from '@/ui-desks/app';
import '@wordpress/components/build-style/style.css';
import '@wordpress/dataviews/build-style/style.css';
import '@wordpress/theme/design-tokens.css';
import '@/index.css';
import type { Connector } from '@/data/core';

interface AppProps {
	connector: Connector;
}

export function App( { connector }: AppProps ) {
	const { mode } = useUiMode();

	useEffect( () => {
		document.body.dataset.studioUiMode = mode;

		return () => {
			delete document.body.dataset.studioUiMode;
		};
	}, [ mode ] );

	return (
		<AppProviders connector={ connector }>
			{ mode === 'desks' ? <DesksUiApp /> : <ClassicUiApp connector={ connector } /> }
		</AppProviders>
	);
}
