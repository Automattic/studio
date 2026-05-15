import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider/context';
import { getSitePreviewUrl } from './url';
import type { SitePreviewWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function SitePreviewOpenControl( {
	props,
}: ControlRenderContext< SitePreviewWidgetProps > ) {
	const connector = useConnector();
	const { siteId } = useDesk();
	const { data: sites } = useSites();
	const site = sites?.find( ( currentSite ) => currentSite.id === siteId );
	const url = getSitePreviewUrl( site, props.path );
	const canOpen = Boolean( url );

	return (
		<Button
			icon={ external }
			label={ __( 'Open site preview in browser' ) }
			variant="quiet"
			size="medium"
			disabled={ ! canOpen }
			onClick={ () => {
				if ( ! url ) {
					return;
				}

				void connector.openExternalUrl( url );
			} }
		/>
	);
}
