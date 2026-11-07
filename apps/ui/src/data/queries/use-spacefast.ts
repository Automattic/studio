import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const SPACEFAST_ACCOUNT_QUERY_KEY = [ 'spacefast-account' ] as const;
export const SPACEFAST_SPACES_QUERY_KEY = [ 'spacefast-spaces' ] as const;
const SPACEFAST_TEAMS_QUERY_KEY = [ 'spacefast-teams' ] as const;
export const spacefastConnectionQueryKey = ( siteId: string ) =>
	[ 'spacefast-connection', siteId ] as const;

export function useSpacefastSignedIn() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SPACEFAST_ACCOUNT_QUERY_KEY,
		queryFn: () => connector.isSpacefastSignedIn(),
	} );
}

export function useSpacefastSpaces( enabled: boolean ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: SPACEFAST_SPACES_QUERY_KEY,
		queryFn: () => connector.listSpacefastSpaces(),
		enabled,
	} );
}

export function useSpacefastTeams( enabled: boolean ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: SPACEFAST_TEAMS_QUERY_KEY,
		queryFn: () => connector.listSpacefastTeams(),
		enabled,
	} );
}

export function useSpacefastConnection( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: spacefastConnectionQueryKey( siteId ),
		queryFn: () => connector.getSpacefastConnection( siteId ),
	} );
}

// Opens Spacefast's approval page and resolves once the user approves this device.
export function useSpacefastLogin() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: async () => {
			const login = await connector.startSpacefastLogin();
			await connector.openExternalUrl( login.verificationUrl );
			await connector.completeSpacefastLogin( login );
		},
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: SPACEFAST_ACCOUNT_QUERY_KEY } );
		},
	} );
}

// Forgets Studio's Spacefast key. Sites stay linked to their Spaces, so signing in
// again resumes publishing to them.
export function useSpacefastLogout() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.logoutSpacefast(),
		onSuccess: () => {
			queryClient.setQueryData( SPACEFAST_ACCOUNT_QUERY_KEY, false );
			queryClient.removeQueries( { queryKey: SPACEFAST_SPACES_QUERY_KEY } );
			queryClient.removeQueries( { queryKey: SPACEFAST_TEAMS_QUERY_KEY } );
		},
	} );
}

export function useDisconnectSpacefastSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( siteId: string ) => connector.disconnectSpacefastSite( siteId ),
		onSuccess: ( _result, siteId ) => {
			void queryClient.invalidateQueries( { queryKey: spacefastConnectionQueryKey( siteId ) } );
		},
	} );
}
