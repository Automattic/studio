import type { SiteEntry } from '@/data/core';

export function SiteBadge( { entry }: { entry: SiteEntry } ) {
	if ( entry.kind === 'local' ) {
		return (
			<span className="badge" data-tone={ entry.site.running ? 'success' : 'neutral' }>
				{ entry.site.running ? 'Running' : 'Stopped' }
			</span>
		);
	}
	return (
		<span className="badge" data-tone={ entry.site.isStaging ? 'warning' : 'neutral' }>
			{ entry.site.isStaging ? 'Staging' : entry.site.planName || 'WordPress.com' }
		</span>
	);
}
