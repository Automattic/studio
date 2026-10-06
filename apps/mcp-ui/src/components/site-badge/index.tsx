import type { LocalSite } from '@/data/types';

export function SiteBadge( { site }: { site: LocalSite } ) {
	return (
		<span className="badge" data-tone={ site.running ? 'success' : 'neutral' }>
			{ site.running ? 'Running' : 'Stopped' }
		</span>
	);
}
