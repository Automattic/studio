import { __ } from '@wordpress/i18n';
import { useOpenHeaderPanel } from '@/data/use-open-header-panel';
import { CloudUploadIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import type { SiteDetails } from '@/data/core';

export function SitePublishMenu( { site }: { site: SiteDetails } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	return (
		<Menu.Item
			onClick={ () => openHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) }
		>
			<CloudUploadIcon />
			{ __( 'Publish' ) }
		</Menu.Item>
	);
}
