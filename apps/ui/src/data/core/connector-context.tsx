import { createContext, useContext, type ReactNode } from 'react';
import type { Connector } from './types';

const ConnectorContext = createContext< Connector | null >( null );

export function ConnectorProvider( {
	connector,
	children,
}: {
	connector: Connector;
	children: ReactNode;
} ) {
	return <ConnectorContext.Provider value={ connector }>{ children }</ConnectorContext.Provider>;
}

export function useConnector(): Connector {
	const ctx = useContext( ConnectorContext );
	if ( ! ctx ) {
		throw new Error( 'useConnector must be used within a ConnectorProvider' );
	}
	return ctx;
}
