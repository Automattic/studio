import { Menu } from '@studio/ds';
import { CloudUploadIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useOpenHeaderPanel } from '@/data/use-open-header-panel';
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
