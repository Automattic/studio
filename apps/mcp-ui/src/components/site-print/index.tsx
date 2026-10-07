import { useSitePreview } from '@/data/queries/use-site-preview';
import type { LocalSite } from '@/data/types';

// A front-page preview on a quiet ground, with a hairline edge.
export function SitePrint( { site }: { site: LocalSite } ) {
	const { data } = useSitePreview( site );
	const state = ! data ? 'loading' : data.src ? 'ready' : 'failed';
	return (
		<span className="print" data-state={ state }>
			<img alt="" src={ data?.src || undefined } />
			<span className="print-note" hidden={ ! data?.note }>
				{ data?.note }
			</span>
		</span>
	);
}
