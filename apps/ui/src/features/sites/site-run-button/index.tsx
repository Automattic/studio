import { useSiteHeader } from '@/features/sites/site-header-actions';
import { IconButton } from '@/lib/ui';
import { useSiteRunAction } from './use-site-run-action';
import type { SiteDetails } from '@/data/core';

export function SiteRunButton( { site }: { site: SiteDetails } ) {
	const { layout } = useSiteHeader();
	const action = useSiteRunAction( site );
	return (
		<span hidden={ layout === 'mobile-overflow' } data-site-header-run>
			<IconButton
				icon={ action.icon }
				label={ action.label }
				tooltipSide="bottom"
				disabled={ action.busy }
				aria-busy={ action.busy || undefined }
				onClick={ action.onClick }
			/>
		</span>
	);
}
