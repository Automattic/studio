import { DEFAULT_HIDE_FRONTEND_ADMIN_BAR } from '@studio/common/lib/user-settings/preferences';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY } from './use-sites';
import { useUserPreferences } from './use-user-preferences';
import type { SiteDetails } from '@/data/core';

export type FrontendAdminBarPreference = 'show' | 'hide';

export function useFrontendAdminBar( {
	site,
	active,
	onReload,
}: {
	site: SiteDetails;
	active: boolean;
	onReload: () => void;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: preferences } = useUserPreferences();
	const defaultHidden = preferences?.hideFrontendAdminBar ?? DEFAULT_HIDE_FRONTEND_ADMIN_BAR;
	const hidden = site.hideFrontendAdminBar ?? defaultHidden;
	const lastApplied = useRef( { siteId: site.id, hidden } );
	useEffect( () => {
		if ( lastApplied.current.siteId !== site.id ) {
			lastApplied.current = { siteId: site.id, hidden };
			return;
		}
		if ( ! active || ! preferences ) return;
		if ( lastApplied.current.hidden !== hidden ) {
			lastApplied.current.hidden = hidden;
			onReload();
		}
	}, [ active, hidden, onReload, preferences, site.id ] );

	const save = useMutation( {
		scope: { id: 'frontend-admin-bar' },
		mutationFn: ( { siteId, hidden }: { siteId: string; hidden: boolean | null } ) =>
			connector.setSiteFrontendAdminBar( siteId, hidden ),
		onSuccess: async ( _result, { siteId, hidden } ) => {
			await queryClient.cancelQueries( { queryKey: SITES_QUERY_KEY } );
			queryClient.setQueryData< SiteDetails[] >(
				SITES_QUERY_KEY,
				( sites ) =>
					sites?.map( ( current ) =>
						current.id === siteId
							? {
									...current,
									hideFrontendAdminBar: hidden ?? undefined,
							  }
							: current
					)
			);
		},
		onError: () => toast.error( __( 'Could not update the admin bar setting. Please try again.' ) ),
	} );

	return {
		value: hidden ? ( 'hide' as const ) : ( 'show' as const ),
		saving: save.isPending,
		onChange: ( value: FrontendAdminBarPreference ) => {
			if ( save.isPending ) return;
			const hidden = value === 'hide';
			save.mutate( { siteId: site.id, hidden: hidden === defaultHidden ? null : hidden } );
		},
	};
}
