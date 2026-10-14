import { useSyncExternalStore } from 'react';
import { getHostState, subscribeHostState } from '@/data/bridge';
import type { HostState } from '@/data/types';

export function useHostState(): HostState {
	return useSyncExternalStore( subscribeHostState, getHostState );
}
