import { Menu } from '@/lib/ui';
import { useSiteRunAction } from './use-site-run-action';
import type { SiteDetails } from '@/data/core';

export function SiteRunMenuItem( { site }: { site: SiteDetails } ) {
	const action = useSiteRunAction( site );
	return (
		<Menu.Item
			disabled={ action.busy }
			aria-busy={ action.busy || undefined }
			onClick={ action.onClick }
		>
			{ action.icon }
			{ action.label }
		</Menu.Item>
	);
}
