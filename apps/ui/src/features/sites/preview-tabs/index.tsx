import { PlusIcon, XIcon } from '@studio/ds/icons';
import { __, _n, isRTL, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut, isAppleOS } from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { Split, SquareSplitHorizontal, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { getPreviewTabGroups } from '@/data/preview-tab-state';
import { previewTabsKey, usePreviewTabs, type PreviewTab } from '@/data/preview-tabs';
import { useIsSiteBusy, useStopSite } from '@/data/queries/use-sites';
import { useIsSiteRestarting } from '@/data/site-restarts';
import { useSessionPreviewUI } from '@/data/use-session-ui';
import { useUserWorkspaceLayoutTransition } from '@/data/use-workspace-layout-tracks';
import { getFileManager } from '@/features/sites/open-in-menu/get-file-manager';
import { useOpenInDestinations } from '@/features/sites/open-in-menu/use-open-in-destinations';
import { getPreviewRealm } from '@/features/sites/site-preview/address-bar';
import { usePreviewOpenTracks } from '@/features/sites/site-preview/use-preview-open-tracks';
import { getSiteTool, SiteToolMenuItems, useSiteToolActions } from '@/features/sites/site-tools';
import { isDialogOpen, isShortcut } from '@/lib/keyboard';
import {
	DropOverlay,
	IconButton,
	Menu,
	Tabs,
	TabsList,
	TabsTrigger,
	ThumbnailTooltip,
	VisuallyHidden,
} from '@studio/ds';
import styles from './style.module.css';
import { useTabReorder } from './use-tab-reorder';
import type { SiteDetails } from '@/data/core';
import type { CSSProperties, MouseEvent } from 'react';

interface TabSelection {
	workspaceKey: string;
	activeGroupId: string;
	anchorId: string;
	groupIds: string[];
}

function getTabTitle( tab: PreviewTab, siteName: string ) {
	if ( tab.path === null ) return __( 'New tab' );
	const realm = getPreviewRealm( tab.path );
	return realm === 'frontend' ? tab.title || siteName : getSiteTool( realm ).label;
}

export function PreviewTabs( {
	site,
	liveUrl,
	path,
}: {
	site: SiteDetails;
	liveUrl?: string;
	path: string;
} ) {
	const connector = useConnector();
	const fileManager = getFileManager();
	const browser = useOpenInDestinations( site ).find( ( entry ) => entry.id === 'browser' )!;
	const { id: siteId, name: siteName } = site;
	const restarting = useIsSiteRestarting( siteId );
	const running = !! liveUrl || site.running || restarting;
	const busy = useIsSiteBusy( site );
	const stopSite = useStopSite();
	const preview = useSessionPreviewUI();
	const runLayoutTransition = useUserWorkspaceLayoutTransition( siteId );
	const trackOpen = usePreviewOpenTracks();
	const workspaceKey = previewTabsKey( siteId, liveUrl );
	const { workspace, add, select, closeMany, update, addToSplit, splitGroups, separate } =
		usePreviewTabs( workspaceKey, path, siteId );
	const tools = useSiteToolActions( site, {
		liveUrl,
		onNavigate: add,
	} );
	const groups = getPreviewTabGroups( workspace );
	const selectedGroup = groups.find( ( group ) =>
		group.some( ( tab ) => tab.id === workspace.selectedId )
	)!;
	const selectedGroupId = selectedGroup[ 0 ].id;
	const groupIds = groups.map( ( group ) => group[ 0 ].id );
	const [ selection, setSelection ] = useState< TabSelection >();
	const currentSelection =
		selection?.workspaceKey === workspaceKey && selection.activeGroupId === selectedGroupId
			? selection
			: undefined;
	const selectedIds = currentSelection?.groupIds.filter( ( id ) => groupIds.includes( id ) ) ?? [];
	const hasSelection = selectedIds.length > 1;
	const list = useRef< HTMLDivElement >( null );

	const selectRange = ( groupId: string ) => {
		const anchorId =
			currentSelection && groupIds.includes( currentSelection.anchorId )
				? currentSelection.anchorId
				: selectedGroupId;
		const anchor = groupIds.indexOf( anchorId );
		const target = groupIds.indexOf( groupId );
		setSelection( {
			workspaceKey,
			activeGroupId: selectedGroupId,
			anchorId,
			groupIds: groupIds.slice( Math.min( anchor, target ), Math.max( anchor, target ) + 1 ),
		} );
	};
	const onTabClick = ( event: MouseEvent< HTMLElement >, groupId: string ) => {
		const toggle = isAppleOS() ? event.metaKey : event.ctrlKey;
		if ( ! event.shiftKey && ! toggle ) {
			setSelection( undefined );
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus();
		if ( event.shiftKey ) {
			selectRange( groupId );
			return;
		}
		const ids = selectedIds.length ? selectedIds : [ selectedGroupId ];
		setSelection( {
			workspaceKey,
			activeGroupId: selectedGroupId,
			anchorId: groupId,
			groupIds: ids.includes( groupId )
				? ids.filter( ( id ) => id !== groupId )
				: [ ...ids, groupId ],
		} );
	};

	const getTitle = ( tab: PreviewTab ) => getTabTitle( tab, siteName );
	const getGroupTitle = ( group: PreviewTab[] ) => group.map( getTitle ).join( ' · ' );
	const renderTabLabel = ( tab: PreviewTab ) => {
		const Icon = getSiteTool( tab.path === null ? 'frontend' : getPreviewRealm( tab.path ) ).Icon;
		return (
			<>
				<Icon className={ styles.icon } aria-hidden="true" />
				<span className={ styles.title }>{ getTitle( tab ) }</span>
			</>
		);
	};
	const renderGroupLabel = ( group: PreviewTab[] ) =>
		group.length === 1
			? renderTabLabel( group[ 0 ] )
			: group.map( ( tab ) => (
					<span key={ tab.id } className={ styles.pairLabel }>
						{ renderTabLabel( tab ) }
					</span>
			  ) );
	const getPanel = () =>
		Array.from( document.querySelectorAll< HTMLElement >( '[data-preview-workspace]' ) ).find(
			( element ) => element.dataset.previewWorkspace === workspaceKey
		);
	const getSplitTargets = () => {
		if ( groups.length < 2 || busy ) return;
		const panel = getPanel();
		if ( ! panel ) return;
		const panelBounds = panel.getBoundingClientRect();
		const viewports = Array.from(
			panel.querySelectorAll( '[data-visible-tab] [data-preview-viewport]' ),
			( element ) => element.getBoundingClientRect()
		).filter( ( bounds ) => bounds.width > 0 && bounds.height > 0 );
		if ( ! viewports.length ) return;
		const top = Math.max( ...viewports.map( ( bounds ) => bounds.top ) );
		const bottom = Math.min( ...viewports.map( ( bounds ) => bounds.bottom ) );
		const area = new DOMRect( panelBounds.left, top, panelBounds.width, bottom - top );
		const inset = 16;
		const width = Math.min( 224, ( area.width - 2 * inset - 24 ) / 2 );
		const height = Math.min( 280, area.height - 2 * inset );
		if ( width <= 0 || height <= 0 ) return;
		return {
			area,
			targets: ( [ 'left', 'right' ] as const ).map( ( side ) => ( {
				side,
				bounds: new DOMRect(
					side === 'left' ? area.left + inset : area.right - inset - width,
					area.top + ( area.height - height ) / 2,
					width,
					height
				),
			} ) ),
		};
	};
	const reorder = useTabReorder( {
		ids: groupIds,
		getLabel: ( id ) => getGroupTitle( groups.find( ( group ) => group[ 0 ].id === id )! ),
		getSplitTargets,
		onSplit: ( id, side ) => {
			setSelection( undefined );
			addToSplit( id, ( side === 'left' ) !== isRTL() ? 'start' : 'end' );
		},
		onReorder: ( ids ) => {
			setSelection( undefined );
			update( ( current ) => {
				if (
					ids.length !== groups.length ||
					ids.some( ( id ) => ! groups.some( ( group ) => group[ 0 ].id === id ) )
				)
					return current;
				return {
					...current,
					tabs: ids.flatMap( ( id ) => groups.find( ( group ) => group[ 0 ].id === id )! ),
				};
			} );
		},
	} );
	const { drag } = reorder;
	const draggedGroup = drag && groups.find( ( group ) => group[ 0 ].id === drag.id );
	const draggedSlot = drag?.slots.find( ( slot ) => slot.id === drag.id );
	const newTabButton = useRef< HTMLButtonElement >( null );
	useLayoutEffect( () => {
		const strip = list.current?.closest< HTMLElement >( '[data-slot="tabs"]' );
		if ( ! strip ) return;
		const rtl = getComputedStyle( strip ).direction === 'rtl';
		const updateFades = () => {
			const max = Math.max( 0, strip.scrollWidth - strip.clientWidth );
			const offset = Math.min( max, Math.max( 0, rtl ? -strip.scrollLeft : strip.scrollLeft ) );
			strip.toggleAttribute( 'data-overflow-left', ( rtl ? max - offset : offset ) > 1 );
			strip.toggleAttribute( 'data-overflow-right', ( rtl ? offset : max - offset ) > 1 );
		};
		const revealSelected = () => {
			if ( strip.closest( '[inert]' ) ) return;
			const selected = list.current?.querySelector< HTMLElement >( '[data-active]' );
			const viewport = strip.getBoundingClientRect();
			if ( selected && viewport.width ) {
				const tab = selected.getBoundingClientRect();
				const padding =
					Number.parseFloat( getComputedStyle( strip ).scrollPaddingInlineStart ) || 0;
				const inset = Math.max( 0, Math.min( padding, ( viewport.width - tab.width ) / 2 ) );
				if ( tab.width > viewport.width ) {
					strip.scrollLeft += rtl ? tab.right - viewport.right : tab.left - viewport.left;
				} else if ( tab.left < viewport.left + inset ) {
					strip.scrollLeft += tab.left - viewport.left - inset;
				} else if ( tab.right > viewport.right - inset ) {
					strip.scrollLeft += tab.right - viewport.right + inset;
				}
			}
			updateFades();
		};
		const observer = new ResizeObserver( revealSelected );
		observer.observe( strip );
		strip.addEventListener( 'scroll', updateFades, { passive: true } );
		revealSelected();
		return () => {
			observer.disconnect();
			strip.removeEventListener( 'scroll', updateFades );
		};
	}, [ running, selectedGroupId, groups.length ] );
	const { setOpen } = preview;
	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				! isShortcut( event, 't' ) ||
				isDialogOpen() ||
				busy
			)
				return;
			event.preventDefault();
			runLayoutTransition( () => setOpen( true, { siteId } ) );
			requestAnimationFrame( () => {
				if ( ! newTabButton.current ) {
					document
						.querySelector< HTMLElement >( '[data-active-tab] [data-site-tool-launcher] button' )
						?.focus();
					return;
				}
				if ( getComputedStyle( newTabButton.current ).display === 'none' ) {
					add( '/' );
					requestAnimationFrame( () => {
						list.current?.querySelector< HTMLElement >( '[data-active]' )?.focus();
					} );
					return;
				}
				newTabButton.current?.focus();
				if ( newTabButton.current?.getAttribute( 'aria-expanded' ) !== 'true' ) {
					newTabButton.current?.click();
				}
			} );
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ add, busy, setOpen, siteId, runLayoutTransition ] );
	const openEmailFolder = () => {
		void connector.openSiteEmailFolder( siteId ).catch( () =>
			showToast( {
				title: __( 'WordPress Studio could not open the email folder.' ),
				intent: 'error',
			} )
		);
	};
	const openInBrowser = ( tab: PreviewTab ) => {
		if ( tab.path === null ) return;
		const realm = getPreviewRealm( tab.path );
		trackOpen( tab.path, 'external' );
		const opening = liveUrl
			? connector.openExternalUrl( `${ liveUrl.replace( /\/$/, '' ) }${ tab.path }` )
			: connector.openSiteUrl( siteId, tab.path, {
					autoLogin: realm !== 'frontend' && ! tab.path.startsWith( '/studio-auto-login' ),
			  } );
		void opening.catch( ( error ) => {
			console.error( 'Failed to open preview tab in browser:', error );
		} );
	};
	const closeTabs = ( ids: string[] ) => {
		setSelection( undefined );
		const isLastTab = workspace.tabs.every( ( tab ) => ids.includes( tab.id ) );
		closeMany( ids );
		if ( isLastTab ) {
			runLayoutTransition( () => preview.setOpen( false, { siteId, instant: true } ) );
			if ( ! liveUrl && site.running && ! busy ) stopSite.mutate( siteId );
		}
		requestAnimationFrame( () => {
			if ( isLastTab ) {
				document.querySelector< HTMLElement >( '[data-workspace-layout="chat"]' )?.focus();
			} else {
				list.current?.querySelector< HTMLElement >( '[data-active]' )?.focus();
			}
		} );
	};
	const getGroupTab = ( group: PreviewTab[] ) => {
		const recent = workspace.recentIds.find( ( id ) => group.some( ( tab ) => tab.id === id ) );
		return group.find( ( tab ) => tab.id === recent ) ?? group[ 0 ];
	};
	const renderTab = ( group: PreviewTab[] ) => {
		const groupId = group[ 0 ].id;
		const paired = group.length > 1;
		const inSelection = selectedIds.includes( groupId );
		const showSelectionMenu = hasSelection && inSelection;
		const otherTabIds = workspace.tabs
			.filter( ( other ) => ! group.includes( other ) )
			.map( ( other ) => other.id );
		const tab = getGroupTab( group );
		const realm = tab.path === null ? 'frontend' : getPreviewRealm( tab.path );
		const destination = realm === 'email' ? fileManager : browser;
		const closeButtons = group.map( ( member ) => (
			<IconButton
				key={ member.id }
				variant="muted-ghost"
				size="icon-2xs"
				className={ styles.close }
				data-tab-close
				icon={ <XIcon width={ 14 } height={ 14 } /> }
				label={ sprintf( __( 'Close %s' ), getTitle( member ) ) }
				onClick={ () => closeTabs( [ member.id ] ) }
				tooltip={ false }
			/>
		) );
		const trigger = (
			<TabsTrigger
				value={ groupId }
				className={ styles.trigger }
				aria-label={ paired ? getGroupTitle( group ) : undefined }
				aria-selected={ hasSelection ? inSelection : groupId === selectedGroupId }
				aria-description={ __(
					'Use Shift+Left or Right Arrow to select tabs. Use Alt+Shift+Left or Right Arrow to move this tab.'
				) }
				onClickCapture={ ( event ) => onTabClick( event, groupId ) }
				onKeyDown={ ( event ) => {
					if (
						event.shiftKey &&
						! event.altKey &&
						! event.metaKey &&
						! event.ctrlKey &&
						( event.key === 'ArrowLeft' || event.key === 'ArrowRight' )
					) {
						event.preventDefault();
						event.stopPropagation();
						const direction = ( event.key === 'ArrowRight' ? 1 : -1 ) * ( isRTL() ? -1 : 1 );
						const next = groupIds.indexOf( groupId ) + direction;
						if ( groupIds[ next ] ) {
							selectRange( groupIds[ next ] );
							list.current?.querySelectorAll< HTMLElement >( '[role="tab"]' )[ next ]?.focus();
						}
						return;
					}
					reorder.onKeyDown( event, groupId );
					if ( ! paired && event.key === 'Delete' ) {
						event.preventDefault();
						closeTabs( [ tab.id ] );
					}
				} }
			>
				{ renderGroupLabel( group ) }
			</TabsTrigger>
		);
		return (
			<Menu.ContextMenuRoot
				key={ groupId }
				onOpenChange={ ( open ) => {
					if ( open && ! inSelection ) setSelection( undefined );
				} }
			>
				<ThumbnailTooltip
					side="bottom"
					label={ sprintf( __( 'Preview of %s' ), getGroupTitle( group ) ) }
					thumbnail={ tab.thumbnail?.path === tab.path ? tab.thumbnail.image : null }
					disabled={ groupId === selectedGroupId || !! drag || ! tab.thumbnail }
					trigger={
						<Menu.ContextMenuTrigger
							render={
								<div
									className={ clsx( styles.tab, groupId === selectedGroupId && styles.selected ) }
									data-tab-reorder-id={ groupId }
									data-preview-tab-pair={ paired || undefined }
									style={
										{
											transform: `translateX(${ reorder.getOffset( groupId ) }px)`,
											'--split-tab-count': group.length,
										} as CSSProperties
									}
									data-drag-source={ drag?.id === groupId || undefined }
									data-preview-selected={ groupId === selectedGroupId || undefined }
									data-preview-multi-selected={ ( hasSelection && inSelection ) || undefined }
								/>
							}
						>
							{ trigger }
							{ paired ? (
								<span className={ styles.pairCloses }>{ closeButtons }</span>
							) : (
								closeButtons
							) }
						</Menu.ContextMenuTrigger>
					}
				/>
				{ showSelectionMenu ? (
					<Menu.ContextPopup>
						<Menu.Item
							disabled={ busy }
							onClick={ () => {
								splitGroups( selectedIds );
								setSelection( undefined );
							} }
						>
							<SquareSplitHorizontal aria-hidden="true" />
							{ __( 'Open as split' ) }
						</Menu.Item>
						<Menu.Separator />
						<Menu.Item
							onClick={ () =>
								closeTabs(
									groups
										.filter( ( selected ) => selectedIds.includes( selected[ 0 ].id ) )
										.flatMap( ( selected ) => selected.map( ( member ) => member.id ) )
								)
							}
						>
							<X />
							{ __( 'Close tabs' ) }
						</Menu.Item>
					</Menu.ContextPopup>
				) : (
					<Menu.ContextPopup>
						<Menu.Item disabled={ busy } onClick={ () => add( '/' ) }>
							<PlusIcon />
							{ __( 'New tab' ) }
						</Menu.Item>
						{ ! paired && groups.length > 1 ? (
							<Menu.Item disabled={ busy } onClick={ () => addToSplit( tab.id ) }>
								<SquareSplitHorizontal aria-hidden="true" />
								{ __( 'Open as split' ) }
							</Menu.Item>
						) : null }
						{ paired ? (
							<Menu.Item onClick={ () => separate( tab.id ) }>
								<Split aria-hidden="true" />
								{ __( 'Separate tabs' ) }
							</Menu.Item>
						) : null }
						{ otherTabIds.length > 0 && <Menu.Separator /> }
						{ ! paired && (
							<Menu.Item onClick={ () => closeTabs( [ tab.id ] ) }>
								<X />
								{ __( 'Close tab' ) }
							</Menu.Item>
						) }
						{ otherTabIds.length > 0 && (
							<Menu.Item onClick={ () => closeTabs( otherTabIds ) }>
								<X />
								{ otherTabIds.length === 1 ? __( 'Close other tab' ) : __( 'Close other tabs' ) }
							</Menu.Item>
						) }
						{ groups.length > 2 && (
							<Menu.Item onClick={ () => closeTabs( workspace.tabs.map( ( other ) => other.id ) ) }>
								<X />
								{ __( 'Close all tabs' ) }
							</Menu.Item>
						) }
						<Menu.Separator />
						<Menu.Item
							disabled={ busy || tab.path === null || realm === 'design' }
							onClick={ realm === 'email' ? openEmailFolder : () => openInBrowser( tab ) }
						>
							{ destination.logo }
							{ /* translators: %s: the browser or system file manager name. */ }
							{ sprintf( __( 'Open in %s' ), destination.label ) }
						</Menu.Item>
					</Menu.ContextPopup>
				) }
			</Menu.ContextMenuRoot>
		);
	};
	if ( ! running ) return null;
	return (
		<div className={ styles.root } data-preview-tabs>
			<Tabs
				value={ selectedGroupId }
				onValueChange={ ( value ) => {
					setSelection( undefined );
					const group = groups.find( ( group ) => group[ 0 ].id === value );
					if ( ! group || group === selectedGroup ) return;
					const tab = getGroupTab( group );
					if ( tab.path !== null ) trackOpen( tab.path );
					select( tab.id );
				} }
				className={ styles.tabs }
			>
				<TabsList
					ref={ list }
					variant="browser"
					aria-label={ __( 'Preview tabs' ) }
					aria-multiselectable="true"
					onKeyDown={ ( event ) => {
						if ( event.key === 'Escape' && selectedIds.length && ! event.defaultPrevented ) {
							event.preventDefault();
							event.stopPropagation();
							setSelection( undefined );
						}
					} }
					className={ styles.list }
					data-tab-dragging={ !! drag || undefined }
					data-tab-drop-committed={ drag?.committed || undefined }
					onPointerDown={ reorder.onPointerDown }
					onClickCapture={ reorder.onClickCapture }
					onDragStart={ ( event ) => event.preventDefault() }
				>
					{ groups.map( renderTab ) }
				</TabsList>
			</Tabs>

			<Menu.Root>
				<Menu.Trigger
					render={
						<IconButton
							ref={ newTabButton }
							className={ styles.newTab }
							size="icon-sm"
							variant="ghost"
							icon={ <PlusIcon /> }
							shortcut={ {
								displayShortcut: displayShortcut.primary( 't' ),
								ariaKeyShortcut: ariaKeyShortcut.primary( 't' ),
							} }
							label={ __( 'New tab' ) }
							tooltipSide="bottom"
							disabled={ busy }
						/>
					}
				/>
				<Menu.Popup>
					<SiteToolMenuItems site={ site } actions={ tools } live={ !! liveUrl } />
				</Menu.Popup>
			</Menu.Root>
			<VisuallyHidden role="status">
				{ hasSelection
					? sprintf(
							/* translators: %d: number of selected tabs. */
							_n( '%d tab selected', '%d tabs selected', selectedIds.length ),
							selectedIds.length
					  )
					: reorder.announcement }
			</VisuallyHidden>
			{ drag && ! drag.landing
				? createPortal( <div className={ styles.dragShield } aria-hidden="true" />, document.body )
				: null }
			{ drag?.splitTargets && ! drag.landing
				? createPortal(
						<div
							className={ styles.splitDropArea }
							aria-hidden="true"
							inert
							style={ {
								left: drag.splitTargets.area.left,
								top: drag.splitTargets.area.top,
								width: drag.splitTargets.area.width,
								height: drag.splitTargets.area.height,
							} }
						>
							{ drag.splitTargets.targets.map( ( { side, bounds } ) => (
								<div
									key={ side }
									className={ styles.splitDropReveal }
									data-side={ side }
									data-visible={ drag.destination !== 'reorder' || undefined }
									style={ {
										left: bounds.left - drag.splitTargets!.area.left,
										top: bounds.top - drag.splitTargets!.area.top,
										width: bounds.width,
										height: bounds.height,
									} }
								>
									<DropOverlay
										className={ styles.splitDropTarget }
										variant="panel"
										data-active={ drag.destination === side || undefined }
									>
										{ __( 'Drop to split' ) }
									</DropOverlay>
								</div>
							) ) }
						</div>,
						document.body
				  )
				: null }
			{ drag && draggedGroup && draggedSlot
				? createPortal(
						<div
							className={ clsx(
								styles.dragPreview,
								draggedGroup === selectedGroup && styles.selected
							) }
							data-preview-selected={ draggedGroup === selectedGroup || undefined }
							data-preview-tab-pair={ draggedGroup.length > 1 || undefined }
							data-tab-drag-preview
							data-landing={ drag.landing || undefined }
							aria-hidden="true"
							style={ {
								width: draggedSlot.width,
								height: draggedSlot.height,
								transform: `translate3d(${ drag.x }px, ${ drag.y }px, 0)`,
							} }
						>
							{ renderGroupLabel( draggedGroup ) }
						</div>,
						document.body
				  )
				: null }
		</div>
	);
}
