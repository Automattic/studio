import { __ } from '@wordpress/i18n';
import * as Menu from '@/components/ui/menu';
import { useOpenHeaderPanel } from '@/hooks/use-open-header-panel';
import { ShareIcon } from '@/lib/icons/share-icon';
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
