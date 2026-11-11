import { __ } from '@wordpress/i18n';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { SiteMenuItems, useSiteActions } from '@/features/sites/site-menu';
import { StartSiteIcon } from '@/lib/icons';
import { IconButton, Menu } from '@/lib/ui';
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
				<Menu.ContextPopup { ...actions.shortcuts }>
					<SiteMenuItems actions={ actions } />
				</Menu.ContextPopup>
			</Menu.ContextMenuRoot>
			{ actions.dialogs }
		</>
	);
}

/** A stopped site's last screenshot; clicking it starts the site. Nothing until one exists. */
export function StoppedSitePreview( {
	site,
	showStartButton = false,
}: {
	site: SiteDetails;
	showStartButton?: boolean;
} ) {
	const { data: thumbnail } = useSiteThumbnail( site.id );
	const startSite = useStartSiteWithChat();
	const isBusy = useIsSiteBusy( site );
	if ( ! thumbnail ) {
		return showStartButton ? (
			<IconButton
				className={ styles.startButton }
				variant="accent"
				shape="round"
				label={ __( 'Start site' ) }
				icon={ <StartSiteIcon fill="currentColor" /> }
				disabled={ isBusy }
				onClick={ () => startSite.mutate( site.id ) }
			/>
		) : null;
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
				<span className={ styles.overlay } aria-hidden="true">
					<span className={ styles.play }>
						<StartSiteIcon fill="currentColor" />
					</span>
				</span>
			</span>
		</button>
	);
}
