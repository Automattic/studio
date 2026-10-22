import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import * as Menu from '@/components/ui/menu';
import { useOpenHeaderPanel } from '@/hooks/use-open-header-panel';
import { shareIcon } from '@/lib/icons';
import type { SiteDetails } from '@/data/core';

export function SiteShareMenuItem( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	return (
		<Menu.Item
			disabled={ disabled }
			onClick={ () => openHeaderPanel( { panel: 'share', siteId: site.id } ) }
		>
			<Icon icon={ shareIcon } />
			{ __( 'Share' ) }
		</Menu.Item>
	);
}
