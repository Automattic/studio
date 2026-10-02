import { useSyncExternalStore } from 'react';
import { useConnector, type HostState } from '@/data/core';

export function useHostState(): HostState {
	const connector = useConnector();
	return useSyncExternalStore( connector.subscribeHostState, connector.getHostState );
}
