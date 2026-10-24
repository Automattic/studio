import { __ } from '@wordpress/i18n';
import { useOpenHeaderPanel } from '@/features/sites';
import { ShareIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import type { SiteDetails } from '@/data/core';

export function SiteShareMenuItem( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	return (
		<Menu.Item
			disabled={ disabled }
			onClick={ () => openHeaderPanel( { panel: 'share', siteId: site.id } ) }
		>
			<ShareIcon />
			{ __( 'Share' ) }
		</Menu.Item>
	);
}
