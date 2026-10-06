import { useQuery } from '@tanstack/react-query';
import { readSitePreview } from '@/data/bridge';
import type { LocalSite } from '@/data/types';

export interface SitePreview {
	src?: string;
	note: string;
}

export function useSitePreview( site: LocalSite ) {
	return useQuery( {
		// A site is captured again once it starts or stops.
		queryKey: [ 'site-preview', site.id, !! site.running ],
		queryFn: async (): Promise< SitePreview > => {
			try {
				const src = await readSitePreview( site.id );
				if ( src ) {
					return { src, note: '' };
				}
				return { note: site.running ? 'No preview' : 'Start the site to see it' };
			} catch {
				return { note: 'No preview' };
			}
		},
		staleTime: Infinity,
		gcTime: Infinity,
	} );
}
