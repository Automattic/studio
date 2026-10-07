import { useQuery } from '@tanstack/react-query';
import { readSitePreview } from '@/data/bridge';
import { safeUrl } from '@/lib/sites';
import type { SiteEntry } from '@/data/types';

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
			if ( probe.naturalWidth !== 400 || probe.naturalHeight !== 300 ) {
				resolve( { src: probe.src, note: '' } );
			} else if ( ++tries > MSHOTS_MAX_TRIES ) {
				resolve( { note: 'No preview yet' } );
			} else {
				setTimeout(
					() => ( probe.src = `${ base }&retry=${ tries }` ),
					Math.min( 1000 + tries * 500, 4000 )
				);
			}
		} );
		probe.addEventListener( 'error', () => resolve( { note: 'No preview' } ) );
		probe.src = base;
	} );
}

async function localPreview( id: string, running: boolean ): Promise< SitePreview > {
	try {
		const src = await readSitePreview( id );
		return src ? { src, note: '' } : { note: running ? 'No preview' : 'Start the site to see it' };
	} catch {
		return { note: 'No preview' };
	}
}

export function useSitePreview( entry: SiteEntry ) {
	return useQuery( {
		// A local site is captured again once it starts or stops.
		queryKey: [
			'site-preview',
			entry.kind,
			entry.site.id,
			entry.kind === 'local' && !! entry.site.running,
		],
		queryFn: (): Promise< SitePreview > => {
			if ( entry.kind === 'local' ) {
				return localPreview( entry.site.id, !! entry.site.running );
			}
			const url = safeUrl( entry.site.url );
			return url ? loadMshot( url ) : Promise.resolve( { note: 'No preview' } );
		},
		staleTime: Infinity,
		gcTime: Infinity,
	} );
}
