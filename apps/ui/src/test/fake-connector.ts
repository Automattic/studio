import { vi, type Mock } from 'vitest';
import {
	createInMemoryConnector,
	type ConnectorMethods,
	type FakeConnectorInitialState,
	type InMemoryConnector,
} from './in-memory-connector';
import type { Connector } from '@/data/core';

export {
	makeSession,
	makeSite,
	TEST_USER,
	type FakeConnectorInitialState,
	type FakeConnectorState,
} from './in-memory-connector';

export type FakeConnector = Omit< InMemoryConnector, keyof ConnectorMethods > & {
	[ K in keyof ConnectorMethods ]: Mock< ConnectorMethods[ K ] >;
};

/**
 * The in-memory connector with every method wrapped in `vi.fn`, so a test can
 * assert calls or replace one with `mockImplementation`.
 */
export function createFakeConnector(
	initial: FakeConnectorInitialState = {},
	overrides: Partial< Connector > = {}
): FakeConnector {
	const connector = createInMemoryConnector( initial, overrides );
	for ( const [ name, value ] of Object.entries( connector ) ) {
		if ( typeof value === 'function' && name !== 'emit' && name !== 'listenerCount' ) {
			Object.assign( connector, { [ name ]: vi.fn( value ) } );
		}
	}
	return connector as FakeConnector;
}
