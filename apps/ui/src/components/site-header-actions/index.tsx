import { __ } from '@wordpress/i18n';
import { moreHorizontal } from '@wordpress/icons';
import { PublishButton } from '@/components/publish-panel';
import { ShareButton, ShareStatusIcon, useShareStatus } from '@/components/share-dialog';
import { SiteLifecycleButton } from '@/components/site-lifecycle-button';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { requestHeaderPanel } from '@/hooks/use-open-header-panel';
import { shareIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { ReactNode, RefObject } from 'react';

/**
 * A site's actions at the end of its header, beside a chat or on its own page:
 * Publish, Start or Stop, and Share. A stopped site keeps Publish out of sight,
 * still there for the site menu to open. When the header is narrow, Share moves
 * into a More menu, after `menuItems`.
 */
export function SiteHeaderActions( {
	site,
	anchor,
	menuItems,
}: {
	site: SiteDetails;
	anchor: RefObject< HTMLElement | null >;
	menuItems?: ReactNode;
} ) {
	const shareStatus = useShareStatus( site.id );
	return (
		<>
			<span hidden={ ! site.running } className={ styles.publish }>
				<PublishButton site={ site } anchor={ anchor } />
			</span>
			<SiteLifecycleButton site={ site } />
			<ShareButton site={ site } className={ styles.share } />
			<Menu.Root modal={ false }>
				<Tooltip>
					<Menu.Trigger
						render={
							<TooltipTrigger
								render={
									<Button
										variant="ghost"
										size="icon"
										className={ styles.more }
										aria-label={ __( 'More preview actions' ) }
										aria-description={ shareStatus.label }
									/>
								}
							/>
						}
					>
						<ShareStatusIcon icon={ moreHorizontal } status={ shareStatus } />
					</Menu.Trigger>
					<TooltipContent side="bottom">{ __( 'More preview actions' ) }</TooltipContent>
				</Tooltip>
				<Menu.Popup side="bottom" align="end">
					<Menu.Item
						aria-description={ shareStatus.label }
						onClick={ () => requestHeaderPanel( { panel: 'share', siteId: site.id } ) }
					>
						<ShareStatusIcon icon={ shareIcon } status={ shareStatus } />
						{ __( 'Share' ) }
					</Menu.Item>
					{ menuItems }
				</Menu.Popup>
			</Menu.Root>
		</>
	);
}
