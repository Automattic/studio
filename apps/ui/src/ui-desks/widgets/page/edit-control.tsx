import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { IconControlButton } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import type { PageWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function PageEditControl( { props }: ControlRenderContext< PageWidgetProps > ) {
	const connector = useConnector();
	const { siteId } = useDesk();
	const { data: sites } = useSites();
	const site = sites?.find( ( currentSite ) => currentSite.id === siteId );
	const canEdit = Boolean( siteId && site?.running && props.pageId > 0 );

	return (
		<IconControlButton
			icon={ pencil }
			label={ __( 'Edit in WP' ) }
			variant="toolbar"
			disabled={ ! canEdit }
			onClick={ () => {
				if ( ! siteId || props.pageId <= 0 ) {
					return;
				}

				void connector.openSiteUrl(
					siteId,
					`/wp-admin/post.php?post=${ props.pageId }&action=edit`
				);
			} }
		/>
	);
}
