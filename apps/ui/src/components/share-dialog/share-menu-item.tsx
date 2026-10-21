import { __ } from '@wordpress/i18n';
import * as Menu from '@/components/menu';
import { useOpenHeaderPanel } from '@/hooks/use-open-header-panel';
import type { SiteDetails } from '@/data/core';

export function SiteShareMenuItem( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	return (
		<Menu.Item
			disabled={ disabled }
			onClick={ () => openHeaderPanel( { panel: 'share', siteId: site.id } ) }
		>
			{ __( 'Share' ) }
		</Menu.Item>
	);
}
