import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useConnector, type Library, type SiteEntry } from '@/data/core';
import { EMPTY_LIBRARY, LIBRARY_QUERY_KEY } from '@/data/queries/use-library';
import { findEntry, parseDeepLink, text } from '@/lib/sites';
import { useOpenSite } from './use-open-site';

// Tools the model can call on the mounted library: read it and open a site.
export function useLiveTools() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const router = useRouter();
	const openSite = useOpenSite();

	useEffect( () => {
		const library = () => queryClient.getQueryData< Library >( LIBRARY_QUERY_KEY ) ?? EMPTY_LIBRARY;
		const view = ( selected: SiteEntry | null ) => {
			const { localSites, wpcom } = library();
			const content = {
				localSites,
				wpcom,
				selected: selected ? { kind: selected.kind, id: String( selected.site.id ) } : null,
			};
			return {
				content: [ { type: 'text', text: JSON.stringify( content ) } ],
				structuredContent: content,
			};
		};
		const current = () => {
			const route = parseDeepLink( router.state.location.pathname );
			return route ? findEntry( library(), route.kind, route.id ) : null;
		};
		connector.setLiveTools( [
			{
				name: 'read_library_view',
				description: 'Reads the sites shown in the open WordPress library and the selected site.',
				inputSchema: { type: 'object', properties: {}, additionalProperties: false },
				annotations: { readOnlyHint: true },
				call: () => view( current() ),
			},
			{
				name: 'open_site',
				description: "Opens a site's page in the WordPress library.",
				inputSchema: {
					type: 'object',
					properties: {
						kind: { type: 'string', enum: [ 'local', 'wpcom' ] },
						id: { type: 'string' },
					},
					required: [ 'kind', 'id' ],
					additionalProperties: false,
				},
				annotations: { readOnlyHint: true },
				call: ( args ) => {
					const kind = args.kind === 'local' || args.kind === 'wpcom' ? args.kind : null;
					const entry = kind && findEntry( library(), kind, text( args.id ) );
					if ( ! entry ) {
						throw new Error( 'That site is not in the library.' );
					}
					openSite( entry.kind, entry.site.id );
					return view( entry );
				},
			},
		] );
	}, [ connector, queryClient, router, openSite ] );
}
