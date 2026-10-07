import type { SiteEntry } from '@/data/types';

export function SiteBadge( { entry }: { entry: SiteEntry } ) {
	if ( entry.kind === 'wpcom' ) {
		return (
			<span className="badge" data-tone={ entry.site.isStaging ? 'warning' : 'neutral' }>
				{ entry.site.isStaging ? 'Staging' : entry.site.planName || 'WordPress.com' }
			</span>
		);
	}
	return (
		<span className="badge" data-tone={ entry.site.running ? 'success' : 'neutral' }>
			{ entry.site.running ? 'Running' : 'Stopped' }
		</span>
	);
}
