import { AppProviders } from '@/app/app-providers';
import { useUiMode, type UiMode } from '@/app/use-ui-mode';
import { ClassicUiApp } from '@/ui-classic/app';
import { DesksUiApp } from '@/ui-desks/app';
import '@wordpress/components/build-style/style.css';
import '@wordpress/dataviews/build-style/style.css';
import '@wordpress/theme/design-tokens.css';
import '@/index.css';
import type { Connector } from '@/data/core';

interface AppProps {
	connector: Connector;
	// Pin the UI to one mode and skip the mode switcher entirely. The web build
	// passes 'classic' so it stays on the agentic UI without deviating from
	// desktop's mode logic (no persistence, no switcher state).
	forcedMode?: UiMode;
}

function UiForMode( { mode, connector }: { mode: UiMode; connector: Connector } ) {
	return mode === 'desks' ? <DesksUiApp /> : <ClassicUiApp connector={ connector } />;
}

function SwitchableUi( { connector }: { connector: Connector } ) {
	const { mode } = useUiMode();
	return <UiForMode mode={ mode } connector={ connector } />;
}

export function App( { connector, forcedMode }: AppProps ) {
	return (
		<AppProviders connector={ connector }>
			{ forcedMode ? (
				<UiForMode mode={ forcedMode } connector={ connector } />
			) : (
				<SwitchableUi connector={ connector } />
			) }
		</AppProviders>
	);
}
