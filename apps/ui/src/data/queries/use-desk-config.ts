import { createDefaultDeskSettings, normalizeDeskSettings } from '@studio/common/lib/desk-settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useConnector } from '@/data/core';
import type { DeskConfig, DeskSettings } from '@/data/core';

const deskSettingsQueryKey = [ 'desk-settings' ] as const;
const userDeskConfigQueryKey = [ 'desk-config', 'user' ] as const;
const siteDeskConfigQueryKey = ( siteId: string ) => [ 'desk-config', 'site', siteId ] as const;
const deskConfigQueryKey = ( siteId?: string ) =>
	siteId ? siteDeskConfigQueryKey( siteId ) : userDeskConfigQueryKey;

export function useDeskConfig( siteId?: string, enabled = true ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: deskConfigQueryKey( siteId ),
		queryFn: () =>
			siteId ? connector.getSiteDeskConfig( siteId ) : connector.getUserDeskConfig(),
		enabled,
		staleTime: 60_000,
	} );
}

export function useSaveDeskConfig( siteId?: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( config: DeskConfig ) =>
			( siteId
				? connector.saveSiteDeskConfig( siteId, config )
				: connector.saveUserDeskConfig( config )
			).then( () => config ),
		onSuccess: ( config ) => {
			queryClient.setQueryData( deskConfigQueryKey( siteId ), config );
		},
	} );
}

export function useDeskSettings() {
	const connector = useConnector();
	return useQuery( {
		queryKey: deskSettingsQueryKey,
		queryFn: async () => normalizeDeskSettings( await connector.getDeskSettings() ),
		placeholderData: () => createDefaultDeskSettings(),
	} );
}

export function useSaveDeskSettings() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( settings: DeskSettings ) =>
			connector.saveDeskSettings( settings ).then( () => settings ),
		onMutate: ( settings ) => {
			queryClient.setQueryData( deskSettingsQueryKey, settings );
		},
		onSuccess: ( settings ) => {
			queryClient.setQueryData( deskSettingsQueryKey, settings );
		},
	} );
}

export function useUpdateDeskSettings() {
	const { data: savedDeskSettings } = useDeskSettings();
	const fallbackDeskSettings = useMemo( () => createDefaultDeskSettings(), [] );
	const deskSettings = savedDeskSettings ?? fallbackDeskSettings;
	const saveDeskSettings = useSaveDeskSettings();

	return useCallback(
		( patch: Partial< DeskSettings > ) => {
			saveDeskSettings.mutate(
				normalizeDeskSettings( {
					...deskSettings,
					...patch,
					updatedAt: new Date().toISOString(),
				} )
			);
		},
		[ deskSettings, saveDeskSettings ]
	);
}
