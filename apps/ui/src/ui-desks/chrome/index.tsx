import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeskSettings, useUpdateDeskSettings } from '@/data/queries/use-desk-config';
import { useSites } from '@/data/queries/use-sites';
import { ChatsTrigger } from '../chats';
import { DeskCreateMenu } from './create-menu';
import { DeskHeader } from './header';
import { DeskSettingsButton } from './settings-button';
import { SiteDetailsDropdown } from './site-details-dropdown';
import { DeskSiteMapButton } from './site-map-button';
import { DeskSiteMapTitle } from './site-map-title';
import {
	moveDeskToolbarButton,
	normalizeDeskToolbarSettings,
	type DeskToolbarButtonId,
	type DeskToolbarLayout,
} from './toolbar-layout';
import { EMPTY_DRAG_STATE, ToolbarRow, type ToolbarDragState } from './toolbar-row';
import { DeskMenu } from './user-menu';

interface DeskChromeProps {
	siteId?: string;
	siteMapOpen?: boolean;
	siteMapPageCount?: number;
	settingsOpen: boolean;
	editingToolbar: boolean;
	onToggleSiteMap?: () => void;
	onToggleSettings: () => void;
}

export function DeskChrome( {
	siteId,
	siteMapOpen = false,
	siteMapPageCount,
	settingsOpen,
	editingToolbar,
	onToggleSiteMap,
	onToggleSettings,
}: DeskChromeProps ) {
	const { data: savedSettings } = useDeskSettings();
	const { data: sites } = useSites();
	const activeSite = sites?.find( ( candidate ) => candidate.id === siteId );
	const fallbackSettings = useMemo( () => createDefaultDeskSettings(), [] );
	const settings = useMemo(
		() => normalizeDeskToolbarSettings( savedSettings ?? fallbackSettings ),
		[ fallbackSettings, savedSettings ]
	);
	const updateDeskSettings = useUpdateDeskSettings();
	const [ dragState, setDragState ] = useState< ToolbarDragState >( EMPTY_DRAG_STATE );
	const clearDragState = useCallback( () => setDragState( EMPTY_DRAG_STATE ), [] );

	useEffect( () => {
		window.addEventListener( 'dragend', clearDragState );
		return () => window.removeEventListener( 'dragend', clearDragState );
	}, [ clearDragState ] );

	const renderButton = ( buttonId: DeskToolbarButtonId ) => {
		switch ( buttonId ) {
			case 'chat':
				return <ChatsTrigger />;
			case 'create':
				return <DeskCreateMenu />;
			case 'site-map':
				return siteId && onToggleSiteMap ? (
					<DeskSiteMapButton siteId={ siteId } open={ siteMapOpen } onToggle={ onToggleSiteMap } />
				) : null;
			case 'settings':
				return <DeskSettingsButton open={ settingsOpen } onToggle={ onToggleSettings } />;
		}
	};

	const reorderButton = (
		buttonId: DeskToolbarButtonId,
		side: keyof DeskToolbarLayout,
		beforeButtonId: DeskToolbarButtonId | null
	) => {
		updateDeskSettings( {
			toolbarLayout: moveDeskToolbarButton(
				settings.toolbarLayout,
				buttonId,
				side,
				beforeButtonId
			),
		} );
	};

	return (
		<DeskHeader
			centerChildren={ siteMapOpen ? <DeskSiteMapTitle pageCount={ siteMapPageCount } /> : null }
			rightChildren={
				<ToolbarRow
					side="right"
					buttonIds={ settings.toolbarLayout.right }
					editing={ editingToolbar }
					renderButton={ renderButton }
					dragState={ dragState }
					setDragState={ setDragState }
					clearDragState={ clearDragState }
					onReorder={ reorderButton }
				/>
			}
		>
			<ToolbarRow
				side="left"
				buttonIds={ settings.toolbarLayout.left }
				editing={ editingToolbar }
				renderButton={ renderButton }
				dragState={ dragState }
				setDragState={ setDragState }
				clearDragState={ clearDragState }
				onReorder={ reorderButton }
				leading={
					<>
						<DeskMenu
							siteId={ siteId }
							disabled={ editingToolbar }
							showSiteName={ settings.showSiteName }
						/>
						{ activeSite ? (
							<SiteDetailsDropdown site={ activeSite } disabled={ editingToolbar } />
						) : null }
					</>
				}
			/>
		</DeskHeader>
	);
}
