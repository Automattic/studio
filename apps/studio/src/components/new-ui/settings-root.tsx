import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { useEffect, useState } from 'react';
import { ColorSystemReference } from 'src/components/new-ui/color-system-reference';
import { ComponentLibrary } from 'src/components/new-ui/component-library';
import { StudioComponentLibrary } from 'src/components/new-ui/studio-component-library';
import { Toolbar } from 'src/components/new-ui/toolbar';
import { WordPressStyles } from 'src/components/wordpress-styles';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import 'src/index.css';

const emotionCache = createCache( {
	key: 'wordpress-components',
	prepend: true,
} );

type SettingsTab = 'general' | 'account' | 'colors' | 'components' | 'studio-components';

function GeneralTab() {
	const [ colorScheme, setColorScheme ] = useState< string >( 'system' );

	useEffect( () => {
		try {
			void getIpcApi()
				.getColorScheme()
				.then( ( scheme ) => setColorScheme( scheme ?? 'system' ) );
		} catch {
			// IPC not available yet
		}
	}, [] );

	const handleColorSchemeChange = async ( scheme: 'system' | 'light' | 'dark' ) => {
		setColorScheme( scheme );
		try {
			await getIpcApi().saveColorScheme( scheme );
		} catch {
			// IPC not available
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h3 className="a8c-subtitle-small text-chrome-text mb-3">Appearance</h3>
				<div className="flex gap-2">
					{ ( [ 'system', 'light', 'dark' ] as const ).map( ( scheme ) => (
						<button
							key={ scheme }
							onClick={ () => handleColorSchemeChange( scheme ) }
							className={ cx(
								'px-3 py-1.5 rounded-md border a8c-body transition-colors capitalize',
								colorScheme === scheme
									? 'border-frame-theme bg-frame-theme/10 text-frame-theme'
									: 'border-chrome-border text-chrome-text hover:bg-chrome-surface'
							) }
						>
							{ scheme }
						</button>
					) ) }
				</div>
			</div>
		</div>
	);
}

function AccountTab() {
	return (
		<div className="flex flex-col gap-4">
			<p className="a8c-body text-chrome-text-secondary">Account settings coming soon.</p>
		</div>
	);
}

const TABS: { key: SettingsTab; label: string }[] = [
	{ key: 'general', label: 'General' },
	{ key: 'account', label: 'Account' },
	{ key: 'colors', label: 'Colors' },
	{ key: 'components', label: 'WP Components' },
	{ key: 'studio-components', label: 'Studio Components' },
];

export default function SettingsRoot() {
	const [ activeTab, setActiveTab ] = useState< SettingsTab >( 'general' );

	return (
		<CacheProvider value={ emotionCache }>
			<WordPressStyles />
			<div className="bg-chrome">
				<Toolbar className="app-drag-region" middle={ <span className="a8c-subtitle-small text-chrome-text">Settings</span> } />
			</div>
			<div className={ cx( 'h-screen bg-chrome flex flex-col app-drag-region select-none' ) }>
				<div className="flex flex-1 min-h-0">
					{ /* Sidebar nav */ }
					<div className="w-[180px] flex-shrink-0 flex flex-col p-3">
						<nav className="flex flex-col gap-1 app-no-drag-region">
							{ TABS.map( ( tab ) => (
								<button
									key={ tab.key }
									onClick={ () => setActiveTab( tab.key ) }
									className={ cx(
										'px-2 py-1.5 rounded-md a8c-body text-left transition-colors',
										activeTab === tab.key
											? 'bg-chrome-surface text-chrome-text font-medium'
											: 'text-chrome-text-secondary hover:text-chrome-text hover:bg-chrome-surface'
									) }
								>
									{ tab.label }
								</button>
							) ) }
						</nav>
					</div>

					{ /* Content */ }
					<div className="flex-1 flex flex-col min-h-0">
						<div className="flex-1 overflow-y-auto app-no-drag-region p-3">
							{ activeTab === 'general' && <GeneralTab /> }
							{ activeTab === 'account' && <AccountTab /> }
							{ activeTab === 'colors' && <ColorSystemReference /> }
							{ activeTab === 'components' && <ComponentLibrary /> }
							{ activeTab === 'studio-components' && <StudioComponentLibrary /> }
						</div>
					</div>
				</div>
			</div>
		</CacheProvider>
	);
}
