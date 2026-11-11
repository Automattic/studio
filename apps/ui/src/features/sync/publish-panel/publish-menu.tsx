import { __ } from '@wordpress/i18n';
import { useOpenHeaderPanel } from '@/data/use-open-header-panel';
import { SyncIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import type { SiteDetails } from '@/data/core';

export function SitePublishMenu( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	return (
		<Menu.Item
			disabled={ disabled }
			onClick={ () => openHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) }
		>
			<SyncIcon />
			{ __( 'Publish' ) }
		</Menu.Item>
	);
}
