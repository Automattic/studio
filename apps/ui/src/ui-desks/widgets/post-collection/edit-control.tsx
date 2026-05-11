import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { IconControlButton } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import type { PostCollectionWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function PostCollectionEditControl( {
	props,
}: ControlRenderContext< PostCollectionWidgetProps > ) {
	const connector = useConnector();
	const { siteId } = useDesk();
	const { data: sites } = useSites();
	const site = sites?.find( ( currentSite ) => currentSite.id === siteId );
	const canOpen = Boolean( siteId && site?.running && props.query.postType === 'post' );

	return (
		<IconControlButton
			disabled={ ! canOpen }
			icon={ external }
			label={ __( 'Open posts' ) }
			variant="toolbar"
			onClick={ () => {
				if ( ! siteId ) {
					return;
				}
				void connector.openSiteUrl( siteId, '/wp-admin/edit.php' );
			} }
		/>
	);
}
