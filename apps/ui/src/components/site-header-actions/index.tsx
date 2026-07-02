import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import { CustomizeMenu } from '@/components/customize-menu';
import * as Menu from '@/components/menu';
import { OpenInMenu } from '@/components/open-in-menu';
import { PublishPickerView } from '@/components/site-dropdown/publish-picker-view';
import { pickLiveSite } from '@/components/site-dropdown/utils';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

// A publish call to action for sites that have never been connected to a
// live WordPress.com site. Opens the same picker the site dropdown uses.
function PublishButton( { site }: { site: SiteDetails } ) {
	const [ pickerOpen, setPickerOpen ] = useState( false );
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	// While connections are still loading, render nothing rather than
	// flashing a publish prompt at already-published sites.
	if ( ! connectedSites || liveSite ) {
		return null;
	}

	return (
		<Menu.Root modal={ false } open={ pickerOpen } onOpenChange={ setPickerOpen }>
			<Menu.Trigger
				render={
					<Button variant="solid" tone="brand" size="small" className={ styles.publishButton }>
						{ __( 'Publish' ) }
					</Button>
				}
			/>
			<Menu.Popup side="bottom" align="end" className={ styles.publishPopup }>
				<PublishPickerView site={ site } onClose={ () => setPickerOpen( false ) } />
			</Menu.Popup>
		</Menu.Root>
	);
}

/**
 * The compact dropdown buttons pinned to the top right of the site panels
 * (Overview and chat), vertically aligned with the preview panel's browser
 * toolbar buttons.
 */
export function SiteHeaderActions( { site }: { site: SiteDetails } ) {
	return (
		<div className={ styles.root }>
			<PublishButton site={ site } />
			<CustomizeMenu site={ site } />
			<OpenInMenu site={ site } />
		</div>
	);
}
