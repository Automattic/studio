import { useState, type MouseEvent, type PointerEvent, type ReactElement } from 'react';
import { sitePinKey } from '@/data/queries/use-sidebar-pins';
import { SiteActionsMenuItems, useSiteActions } from '@/features/sites';
import { Menu } from '@/lib/ui';
import { BulkMenu, useIsBulkTarget } from './selection';
import type { SiteDetails } from '@/data/core';

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
				<Menu.ContextMenuTrigger render={ trigger } { ...actions.shortcuts } />
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
						<SiteActionsMenuItems actions={ actions } />
					</Menu.ContextPopup>
				) }
			</Menu.ContextMenuRoot>
			{ actions.dialogs }
		</>
	);
}
