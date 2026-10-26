import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useLayoutEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConnectorProvider, type Connector } from '@/data/core';
import { applyTheme } from '@/lib/theme';
import { Tabs, TabsList, TabsScopeIndicator, TabsTrigger, TooltipProvider } from '@/lib/ui';
import { createInMemoryConnector } from '@/test/in-memory-connector';
import styles from './style.module.css';

const SCHEMES = [ 'light', 'dark', 'both' ] as const;

function Playground( { title, children }: { title: string; children: ReactNode } ) {
	const [ scheme, setScheme ] = useState< ( typeof SCHEMES )[ number ] >( 'both' );
	useLayoutEffect( () => applyTheme( scheme === 'dark' ? 'dark' : 'light', {} ), [ scheme ] );
	return (
		<div className={ styles.page }>
			<header className={ styles.header }>
				<h1 className={ styles.title }>
					<a href="/playground.html">Playground</a> / { title }
				</h1>
				<Tabs value={ scheme } onValueChange={ setScheme }>
					<TabsList variant="scope" aria-label="Color scheme" className={ styles.schemes }>
						{ SCHEMES.map( ( option ) => (
							<TabsTrigger key={ option } value={ option }>
								{ option }
							</TabsTrigger>
						) ) }
						<TabsScopeIndicator />
					</TabsList>
				</Tabs>
			</header>
			<div className={ styles.columns }>
				{ scheme === 'both' ? (
					<>
						<div className={ styles.column } data-color-scheme="light">
							{ children }
						</div>
						<div className={ styles.column } data-color-scheme="dark">
							{ children }
						</div>
					</>
				) : (
					<div className={ styles.column }>{ children }</div>
				) }
			</div>
		</div>
	);
}

let root: Root | undefined;
import.meta.hot?.dispose( () => {
	root?.unmount();
	root = undefined;
} );

/** Renders real components on the in-memory connector, light and dark side by side. */
export function renderPlayground(
	title: string,
	children: ReactNode,
	connector: Partial< Connector > = {}
) {
	const queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );
	root ??= createRoot( document.getElementById( 'root' )! );
	root.render(
		<StrictMode>
			<ConnectorProvider connector={ createInMemoryConnector( {}, connector ) }>
				<QueryClientProvider client={ queryClient }>
					<TooltipProvider>
						<Playground title={ title }>{ children }</Playground>
					</TooltipProvider>
				</QueryClientProvider>
			</ConnectorProvider>
		</StrictMode>
	);
}
