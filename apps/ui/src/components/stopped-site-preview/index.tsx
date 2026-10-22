import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { SiteActionsMenuItems, useSiteActions } from '@/components/site-actions-menu';
import * as Menu from '@/components/ui/menu';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useIsSiteBusy, useStartSite } from '@/data/queries/use-sites';
import { playIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { ReactElement } from 'react';

/** The site's actions on right-click, for the preview area of a stopped site. */
export function SiteContextMenu( {
	site,
	disabled,
	children,
}: {
	site?: SiteDetails;
	disabled: boolean;
	children: ReactElement;
} ) {
	return site ? (
		<SiteActionsContextMenu site={ site } disabled={ disabled }>
			{ children }
		</SiteActionsContextMenu>
	) : (
		children
	);
}

function SiteActionsContextMenu( {
	site,
	disabled,
	children,
}: {
	site: SiteDetails;
	disabled: boolean;
	children: ReactElement;
} ) {
	const actions = useSiteActions( site );
	return (
		<>
			<Menu.ContextMenuRoot disabled={ disabled }>
				<Menu.ContextMenuTrigger render={ children } />
				<Menu.ContextPopup onKeyDown={ ( event ) => actions.handleShortcut( event.nativeEvent ) }>
					<SiteActionsMenuItems actions={ actions } />
				</Menu.ContextPopup>
			</Menu.ContextMenuRoot>
			{ actions.dialogs }
		</>
	);
}

/** A stopped site's last screenshot; clicking it starts the site. Nothing until one exists. */
export function StoppedSitePreview( { site }: { site: SiteDetails } ) {
	const { data: thumbnail } = useSiteThumbnail( site.id );
	const startSite = useStartSite();
	const isBusy = useIsSiteBusy( site );
	if ( ! thumbnail ) {
		return null;
	}
	return (
		<button
			type="button"
			className={ styles.root }
			aria-label={ __( 'Start from preview' ) }
			disabled={ isBusy }
			onClick={ () => startSite.mutate( site.id ) }
		>
			<span className={ styles.frame }>
				<img src={ thumbnail } alt={ __( 'Saved site preview' ) } draggable={ false } />
			</span>
			<span className={ styles.overlay } aria-hidden="true">
				<span className={ styles.play }>
					<Icon icon={ playIcon } size={ 32 } />
				</span>
			</span>
		</button>
	);
}
