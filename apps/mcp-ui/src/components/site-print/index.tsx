import { useSitePreview } from '@/data/queries/use-site-preview';
import type { SiteEntry } from '@/data/core';

// A front-page preview on a quiet ground, with a hairline edge.
export function SitePrint( { entry }: { entry: SiteEntry } ) {
	const { data } = useSitePreview( entry );
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
