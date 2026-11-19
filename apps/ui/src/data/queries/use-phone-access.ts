import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { PhoneConnections } from '@/data/core';
import type { RemoteConnectionRequest } from '@studio/common/lib/remote-connection';

const PHONE_ACCESS_QUERY_KEY = [ 'phone-access' ] as const;
const PHONE_PAIRING_CODE_QUERY_KEY = [ 'phone-pairing-code' ] as const;
const PAIRED_PHONES_QUERY_KEY = [ 'paired-phones' ] as const;
const PHONE_CONNECTIONS_QUERY_KEY = [ 'phone-connections' ] as const;

// Read again while Settings > Phone is open: remote mode can stop by itself or
// start in a terminal, and a phone can pair at any time.
const REFRESH_MS = 3000;

export function usePhoneAccess() {
	const connector = useConnector();
	return useQuery( {
		queryKey: PHONE_ACCESS_QUERY_KEY,
		queryFn: () => connector.getPhoneAccess(),
		refetchInterval: REFRESH_MS,
		meta: { persist: false },
	} );
}

export function useSetPhoneAccess() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( on: boolean ) => connector.setPhoneAccess( on ),
		onSuccess: ( state ) => queryClient.setQueryData( PHONE_ACCESS_QUERY_KEY, state ),
	} );
}

// Read when the section opens, and again on demand: it runs the Tailscale CLI,
// so not on the 3-second refresh. Dropped when the section closes.
export function usePhoneConnections() {
	const connector = useConnector();
	return useQuery( {
		queryKey: PHONE_CONNECTIONS_QUERY_KEY,
		queryFn: () => connector.getPhoneConnections(),
		staleTime: Infinity,
		gcTime: 0,
		meta: { persist: false },
	} );
}

export function useSetPhoneConnection() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( request: RemoteConnectionRequest ) => connector.setPhoneConnection( request ),
		onSuccess: async ( state, request ) => {
			// A read still on its way would put back the connection it saw.
			await queryClient.cancelQueries( { queryKey: PHONE_CONNECTIONS_QUERY_KEY } );
			queryClient.setQueryData( PHONE_ACCESS_QUERY_KEY, state );
			queryClient.setQueryData(
				PHONE_CONNECTIONS_QUERY_KEY,
				( current: PhoneConnections | undefined ) => current && { ...current, request }
			);
			// A restart drops the codes, even when the address stays the same.
			void queryClient.invalidateQueries( { queryKey: PHONE_PAIRING_CODE_QUERY_KEY } );
		},
	} );
}

// One code per address, kept out of the persisted cache and dropped when the
// section closes. The panel asks for a new one when it runs out or a phone
// used it; the main process then revokes the old one. The last one shown stays
// valid until it expires, as a code from `studio remote pair` does.
export function usePhonePairingCode( url: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...PHONE_PAIRING_CODE_QUERY_KEY, url ],
		queryFn: () => connector.getPhonePairingCode(),
		staleTime: Infinity,
		gcTime: 0,
		meta: { persist: false },
	} );
}

export function usePairedPhones() {
	const connector = useConnector();
	return useQuery( {
		queryKey: PAIRED_PHONES_QUERY_KEY,
		queryFn: () => connector.getPairedPhones(),
		refetchInterval: REFRESH_MS,
		meta: { persist: false },
	} );
}

export function useRemovePairedPhone() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( id: string ) => connector.removePairedPhone( id ),
		onSettled: () => queryClient.invalidateQueries( { queryKey: PAIRED_PHONES_QUERY_KEY } ),
	} );
}
