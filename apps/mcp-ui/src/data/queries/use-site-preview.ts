import { useQuery } from '@tanstack/react-query';
import { useConnector, type SiteEntry } from '@/data/core';
import { safeUrl } from '@/lib/sites';

export interface SitePreview {
	src?: string;
	note: string;
}

const MSHOTS_MAX_TRIES = 25;

// mShots answers with a 400x300 placeholder while it renders the screenshot.
function loadMshot( url: string ): Promise< SitePreview > {
	const base = `https://s0.wp.com/mshots/v1/${ encodeURIComponent( url ) }?w=1280&h=582`;
	return new Promise( ( resolve ) => {
		const probe = new Image();
		let tries = 0;
		probe.addEventListener( 'load', () => {
			if ( probe.naturalWidth === 400 && probe.naturalHeight === 300 ) {
				if ( ++tries > MSHOTS_MAX_TRIES ) {
					resolve( { note: 'No preview yet' } );
					return;
				}
				setTimeout(
					() => {
						probe.src = `${ base }&retry=${ tries }`;
					},
					Math.min( 1000 + tries * 500, 4000 )
				);
				return;
			}
			resolve( { src: probe.src, note: '' } );
		} );
		probe.addEventListener( 'error', () => resolve( { note: 'No preview' } ) );
		probe.src = base;
	} );
}

export function useSitePreview( entry: SiteEntry ) {
	const connector = useConnector();
	return useQuery( {
		// A local site is captured again once it starts or stops.
		queryKey: [ 'site-preview', entry.key, entry.kind === 'local' && !! entry.site.running ],
		queryFn: async (): Promise< SitePreview > => {
			if ( entry.kind === 'wpcom' ) {
				const url = safeUrl( entry.site.url );
				return url ? loadMshot( url ) : { note: 'No preview' };
			}
			try {
				const src = await connector.readSitePreview( entry.site.id );
				if ( src ) {
					return { src, note: '' };
				}
				return { note: entry.site.running ? 'No preview' : 'Start the site to see it' };
			} catch {
				return { note: 'No preview' };
			}
		},
		staleTime: Infinity,
		gcTime: Infinity,
	} );
}
