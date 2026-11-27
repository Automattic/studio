import { Menu, ThumbnailTooltip, ThumbnailTooltipImage } from '@studio/ds';
import { __ } from '@wordpress/i18n';
import { useState, type MouseEvent, type PointerEvent, type ReactElement } from 'react';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { sitePinKey } from '@/data/queries/use-sidebar-pins';
import { SiteMenuItems, useSiteActions } from '@/features/sites';
import { BulkMenu, useIsBulkTarget } from './selection';
import type { SiteDetails } from '@/data/core';

function SiteRowThumbnail( { siteId }: { siteId: string } ) {
	const { data: thumbnail } = useSiteThumbnail( siteId );
	return <ThumbnailTooltipImage thumbnail={ thumbnail } label={ __( 'Saved site preview' ) } />;
}

// Right-click quick actions for a sidebar site row. The row element itself is
// passed as `trigger` and rendered via the context-menu trigger's render prop,
// so no wrapper DOM is added around it (the sidebar's drag-reorder CSS and
// animation code rely on the row's DOM position).
export function SiteRowMenu( {
	site,
	trigger,
	onSiteOpen,
	onStart,
}: {
	site: SiteDetails;
	trigger: ReactElement;
	onSiteOpen?: () => void;
	onStart?: () => void;
} ) {
	const actions = useSiteActions( site, { onOpen: onSiteOpen, onStart } );
	const bulk = useIsBulkTarget( sitePinKey( site.id ) );
	const [ menuOpen, setMenuOpen ] = useState( false );

	const stopMenuEventPropagation = (
		event: MouseEvent< HTMLElement > | PointerEvent< HTMLElement >
	) => {
		event.stopPropagation();
	};

	return (
		<>
			<Menu.ContextMenuRoot open={ menuOpen } onOpenChange={ setMenuOpen }>
				<ThumbnailTooltip
					side="inline-end"
					disabled={ menuOpen }
					trigger={ <Menu.ContextMenuTrigger render={ trigger } { ...actions.shortcuts } /> }
				>
					<SiteRowThumbnail siteId={ site.id } />
				</ThumbnailTooltip>
				{ bulk ? (
					<BulkMenu
						onClose={ () => setMenuOpen( false ) }
						onClick={ stopMenuEventPropagation }
						onPointerDown={ stopMenuEventPropagation }
					/>
				) : (
					<Menu.ContextPopup
						onClick={ stopMenuEventPropagation }
						onPointerDown={ stopMenuEventPropagation }
						{ ...actions.shortcuts }
					>
						<SiteMenuItems actions={ actions } />
					</Menu.ContextPopup>
				) }
			</Menu.ContextMenuRoot>
			{ actions.dialogs }
		</>
	);
}
