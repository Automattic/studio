import { ExternalLinkIcon, GlobeIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { spaceDashboardUrl, type Space } from './descriptor';
import type { ProviderUi, SiteRowsProps } from '../types';

function SpacefastSiteRows( { site, disabled, openUrl, Row }: SiteRowsProps< Space > ) {
	const url = spaceDashboardUrl( site );
	if ( ! url ) {
		return null;
	}
	return (
		<Row
			icon={ <GlobeIcon /> }
			label={ __( 'Add a domain' ) }
			trailing={ <ExternalLinkIcon /> }
			disabled={ disabled }
			onClick={ () => openUrl( `${ url }/domains/add` ) }
		/>
	);
}

export const spacefastUi: ProviderUi< Space > = { SiteRows: SpacefastSiteRows };
