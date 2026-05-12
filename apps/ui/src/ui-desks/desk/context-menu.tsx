import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';
import {
	category,
	chevronLeft,
	chevronRight,
	comment,
	external,
	group,
	link,
	pencil,
	trash,
	ungroup,
	update,
	verse,
} from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { SelectionChatDialog } from '@/ui-desks/chats/selection-chat-dialog';
import { LinkFromUrlDialog } from '@/ui-desks/chrome/link-from-url-dialog';
import { canvasShapeToDeskWidget } from '@/ui-desks/desk/tldraw-adapter';
import { collapseStackInEditor, expandStackInEditor } from '@/ui-desks/stacks/editor-commands';
import { createStackId, getStackId, isStackExpanded } from '@/ui-desks/stacks/utils';
import { ARTEFACT_WIDGET_TYPE } from '@/ui-desks/widgets/artefact/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
import { POST_COLLECTION_WIDGET_TYPE } from '@/ui-desks/widgets/post-collection/types';
import { getCreatableWidgetDefinitions, getWidgetDefinition } from '@/ui-desks/widgets/registry';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import styles from './context-menu.module.css';
import { useDesk } from './provider';
import type { DeskContextMenuState } from './context-menu-state';
import type { DeskWidget, DeskWidgetDefinition } from '@/ui-desks/widgets/types';
import type { Editor, TLShape, TLShapeId } from 'tldraw';

type MenuMode = 'main' | 'show-as' | 'insert' | 'pick-post' | 'pick-page';

interface DeskCanvasContextMenuProps {
	editor: Editor;
	state: DeskContextMenuState;
	onClose: () => void;
}

const MENU_WIDTH = 240;
const PICKER_WIDTH = 300;
const MENU_MAX_HEIGHT = 420;
const VIEWPORT_MARGIN = 8;

export function DeskCanvasContextMenu( { editor, state, onClose }: DeskCanvasContextMenuProps ) {
	const connector = useConnector();
	const desk = useDesk();
	const { data: sites, isLoading: isLoadingSites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === desk.siteId );
	const isSiteRunning = Boolean( site?.running );
	const singleShape =
		state.kind === 'single' && state.shapeIds[ 0 ] ? editor.getShape( state.shapeIds[ 0 ] ) : null;
	const singleWidget = singleShape ? canvasShapeToDeskWidget( singleShape ) : null;
	const singleDefinition = singleWidget ? getWidgetDefinition( singleWidget.type ) : undefined;
	const [ menuMode, setMenuMode ] = useState< MenuMode >( 'main' );
	const [ isLinkDialogOpen, setIsLinkDialogOpen ] = useState( false );
	const [ chatWidgets, setChatWidgets ] = useState< DeskWidget[] | null >( null );
	const creatableWidgetDefinitions = getCreatableWidgetDefinitions().filter( ( definition ) =>
		isWidgetAvailableInDeskContext( definition, Boolean( desk.siteId ) )
	);
	const canEditSingle = Boolean(
		singleShape &&
			singleWidget &&
			canEditWidget( singleWidget, {
				hasRunningSite: isSiteRunning,
				hasSiteId: Boolean( desk.siteId ),
			} )
	);
	const canFitSingle = Boolean(
		singleWidget && singleDefinition?.getFittedShapeProps && state.kind === 'single'
	);
	const stackId = getSelectionStackId( editor, state.shapeIds );
	const isStack = state.kind === 'multi' && Boolean( stackId );
	const currentStackView =
		stackId && isStackExpanded( editor.getShape( state.shapeIds[ 0 ] ) ) ? 'tiles' : 'stack';
	const selectedWidgets = getWidgetsForShapeIds( editor, state.shapeIds );
	const canChat = selectedWidgets.length > 0;

	useEffect( () => {
		setMenuMode( 'main' );
		setIsLinkDialogOpen( false );
		setChatWidgets( null );
	}, [ state.x, state.y ] );

	useEffect( () => {
		function handleKeyDown( event: KeyboardEvent ) {
			if ( event.key !== 'Escape' || isLinkDialogOpen || chatWidgets ) {
				return;
			}

			if ( menuMode === 'pick-post' || menuMode === 'pick-page' ) {
				setMenuMode( 'insert' );
				return;
			}

			if ( menuMode !== 'main' ) {
				setMenuMode( 'main' );
				return;
			}

			onClose();
		}

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ chatWidgets, isLinkDialogOpen, menuMode, onClose ] );

	if ( isLinkDialogOpen ) {
		return <LinkFromUrlDialog center={ state.pagePoint } onClose={ onClose } />;
	}

	if ( chatWidgets ) {
		return <SelectionChatDialog widgets={ chatWidgets } onClose={ onClose } />;
	}

	const position = getMenuPosition( state, menuMode );

	const closeAfter = ( action: () => void | Promise< void > ) => {
		const result = action();
		if ( result instanceof Promise ) {
			void result.finally( onClose );
			return;
		}
		onClose();
	};

	return (
		<>
			<button
				type="button"
				className={ styles.backdrop }
				aria-label={ __( 'Close context menu' ) }
				data-ui-desks-context-menu
				onMouseDown={ onClose }
				onContextMenu={ ( event ) => {
					event.preventDefault();
					onClose();
				} }
			/>
			<div
				className={ clsx(
					styles.menu,
					( menuMode === 'pick-post' || menuMode === 'pick-page' ) && styles.picker
				) }
				style={ position }
				role="menu"
				data-ui-desks-context-menu
				onMouseDown={ ( event ) => event.stopPropagation() }
				onContextMenu={ ( event ) => event.preventDefault() }
			>
				{ state.kind === 'single' && menuMode === 'main' && (
					<>
						{ canEditSingle && (
							<ContextMenuItem onClick={ () => closeAfter( () => handleEditWidget() ) }>
								<span>{ __( 'Edit' ) }</span>
								<Icon icon={ pencil } />
							</ContextMenuItem>
						) }
						{ canFitSingle && (
							<ContextMenuItem
								onClick={ () =>
									closeAfter( async () => {
										await desk.fitSelectedWidgetToContent();
									} )
								}
							>
								<span>
									{ singleWidget?.type === NOTE_WIDGET_TYPE
										? __( 'Fit text' )
										: __( 'Fit to size' ) }
								</span>
								<Icon icon={ update } />
							</ContextMenuItem>
						) }
						<ContextMenuItem onClick={ () => closeAfter( () => duplicateSelection() ) }>
							<span>{ __( 'Duplicate' ) }</span>
						</ContextMenuItem>
						<ContextMenuItem
							onClick={ () =>
								closeAfter( () => {
									editor.bringToFront( state.shapeIds );
								} )
							}
						>
							<span>{ __( 'Bring to front' ) }</span>
						</ContextMenuItem>
						<ChatMenuItem
							disabled={ ! canChat }
							onClick={ () => setChatWidgets( selectedWidgets ) }
						/>
						<ContextMenuSeparator />
						<ContextMenuItem
							onClick={ () =>
								closeAfter( () => {
									editor.deleteShapes( state.shapeIds );
								} )
							}
						>
							<span>{ __( 'Remove' ) }</span>
							<Icon icon={ trash } />
						</ContextMenuItem>
					</>
				) }
				{ state.kind === 'multi' && ! isStack && menuMode === 'main' && (
					<>
						<ContextMenuItem
							disabled={ ! desk.canAddWidgets }
							onClick={ () => closeAfter( () => void desk.stackSelectedWidgets() ) }
						>
							<span>{ __( 'Create stack' ) }</span>
							<Icon icon={ group } />
						</ContextMenuItem>
						<ChatMenuItem
							disabled={ ! canChat }
							onClick={ () => setChatWidgets( selectedWidgets ) }
						/>
						<ContextMenuSeparator />
						<ContextMenuItem
							onClick={ () =>
								closeAfter( () => {
									editor.deleteShapes( state.shapeIds );
								} )
							}
						>
							<span>{ __( 'Remove' ) }</span>
							<Icon icon={ trash } />
						</ContextMenuItem>
					</>
				) }
				{ state.kind === 'multi' && isStack && menuMode === 'main' && (
					<>
						<ContextMenuItem onClick={ () => setMenuMode( 'show-as' ) }>
							<span>{ __( 'Show as…' ) }</span>
							<Icon icon={ chevronRight } />
						</ContextMenuItem>
						<ContextMenuItem
							onClick={ () => closeAfter( () => void desk.unstackSelectedWidgets() ) }
						>
							<span>{ __( 'Unstack' ) }</span>
							<Icon icon={ ungroup } />
						</ContextMenuItem>
						<ContextMenuItem onClick={ () => closeAfter( () => duplicateSelection() ) }>
							<span>{ __( 'Duplicate' ) }</span>
						</ContextMenuItem>
						<ChatMenuItem
							disabled={ ! canChat }
							onClick={ () => setChatWidgets( selectedWidgets ) }
						/>
						<ContextMenuSeparator />
						<ContextMenuItem
							onClick={ () =>
								closeAfter( () => {
									editor.deleteShapes( state.shapeIds );
								} )
							}
						>
							<span>{ __( 'Remove' ) }</span>
							<Icon icon={ trash } />
						</ContextMenuItem>
					</>
				) }
				{ state.kind === 'multi' && isStack && menuMode === 'show-as' && (
					<>
						<ContextMenuBackItem onClick={ () => setMenuMode( 'main' ) } />
						<ContextMenuSeparator />
						<ContextMenuItem
							active={ currentStackView === 'stack' }
							onClick={ () =>
								closeAfter( () => {
									if ( stackId ) {
										collapseStackInEditor( editor, stackId );
									}
								} )
							}
						>
							<span>{ __( 'Stack' ) }</span>
							<Icon icon={ group } />
						</ContextMenuItem>
						<ContextMenuItem
							active={ currentStackView === 'tiles' }
							onClick={ () =>
								closeAfter( () => {
									if ( stackId ) {
										expandStackInEditor( editor, stackId );
									}
								} )
							}
						>
							<span>{ __( 'Tiles' ) }</span>
							<Icon icon={ category } />
						</ContextMenuItem>
					</>
				) }
				{ state.kind === 'empty' && menuMode === 'main' && (
					<>
						<ContextMenuItem
							disabled={ ! desk.canAddWidgets }
							onClick={ () => setMenuMode( 'insert' ) }
						>
							<span>{ __( 'Insert…' ) }</span>
							<Icon icon={ chevronRight } />
						</ContextMenuItem>
						<ContextMenuItem
							disabled={ ! desk.canAddWidgets }
							onClick={ () => closeAfter( () => void desk.startDrawing() ) }
						>
							<span>{ __( 'Draw' ) }</span>
							<Icon icon={ verse } />
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={ ! desk.siteId || ! isSiteRunning }
							onClick={ () =>
								closeAfter( async () => {
									if ( desk.siteId ) {
										await connector.openSiteUrl( desk.siteId );
									}
								} )
							}
						>
							<span>{ __( 'Go to site' ) }</span>
							<Icon icon={ external } />
						</ContextMenuItem>
						<ContextMenuItem
							disabled={ ! desk.siteId || ! isSiteRunning }
							onClick={ () =>
								closeAfter( async () => {
									if ( desk.siteId ) {
										await connector.openSiteUrl( desk.siteId, '/wp-admin/' );
									}
								} )
							}
						>
							<span>{ __( 'Go to admin' ) }</span>
							<Icon icon={ external } />
						</ContextMenuItem>
					</>
				) }
				{ state.kind === 'empty' && menuMode === 'insert' && (
					<>
						<ContextMenuBackItem onClick={ () => setMenuMode( 'main' ) } />
						<ContextMenuSeparator />
						{ creatableWidgetDefinitions.map( ( definition ) => (
							<ContextMenuItem
								key={ definition.type }
								disabled={ isWidgetCreationDisabled(
									definition,
									desk.canAddWidgets,
									isSiteRunning
								) }
								onClick={ () =>
									closeAfter( () => {
										desk.addWidget( definition.type, {
											center: state.pagePoint,
											shouldStartEditing: definition.shouldStartEditingOnCreate,
										} );
									} )
								}
							>
								{ definition.icon && <Icon icon={ definition.icon } /> }
								<span>{ definition.labels.add() }</span>
							</ContextMenuItem>
						) ) }
						<ContextMenuItem
							disabled={ ! desk.canAddWidgets }
							onClick={ () => setIsLinkDialogOpen( true ) }
						>
							<Icon icon={ link } />
							<span>{ __( 'New link from URL' ) }</span>
						</ContextMenuItem>
						<ContextMenuItem
							disabled={ ! desk.canAddWidgets }
							onClick={ () => closeAfter( () => void desk.startDrawing() ) }
						>
							<Icon icon={ verse } />
							<span>{ __( 'New drawing' ) }</span>
						</ContextMenuItem>
						{ desk.siteId && (
							<>
								<ContextMenuItem
									disabled={ isWidgetCreationDisabled(
										postWidgetDefinition,
										desk.canAddWidgets,
										isSiteRunning
									) }
									onClick={ () => setMenuMode( 'pick-post' ) }
								>
									{ postWidgetDefinition.icon && <Icon icon={ postWidgetDefinition.icon } /> }
									<span>{ postWidgetDefinition.labels.add() }</span>
									<Icon icon={ chevronRight } />
								</ContextMenuItem>
								<ContextMenuItem
									disabled={ isWidgetCreationDisabled(
										pageWidgetDefinition,
										desk.canAddWidgets,
										isSiteRunning
									) }
									onClick={ () => setMenuMode( 'pick-page' ) }
								>
									{ pageWidgetDefinition.icon && <Icon icon={ pageWidgetDefinition.icon } /> }
									<span>{ pageWidgetDefinition.labels.add() }</span>
									<Icon icon={ chevronRight } />
								</ContextMenuItem>
							</>
						) }
					</>
				) }
				{ state.kind === 'empty' && ( menuMode === 'pick-post' || menuMode === 'pick-page' ) && (
					<ExistingContentPickerMenuItems
						type={ menuMode === 'pick-page' ? 'page' : 'post' }
						canAddWidgets={ desk.canAddWidgets }
						isLoadingSites={ isLoadingSites }
						hasSite={ Boolean( site ) }
						canQueryPosts={ isSiteRunning }
						onBack={ () => setMenuMode( 'insert' ) }
						onSelect={ ( id ) =>
							closeAfter( () => {
								desk.addWidget( menuMode === 'pick-page' ? PAGE_WIDGET_TYPE : POST_WIDGET_TYPE, {
									center: state.pagePoint,
									widgetProps: {
										...( menuMode === 'pick-page'
											? { pageId: id, tone: 'neutral' }
											: { postId: id } ),
									},
									shouldStartEditing: false,
								} );
							} )
						}
					/>
				) }
			</div>
		</>
	);

	function handleEditWidget() {
		if ( ! singleShape || ! singleWidget ) {
			return;
		}

		if (
			singleWidget.type === NOTE_WIDGET_TYPE ||
			singleWidget.type === SITE_PREVIEW_WIDGET_TYPE ||
			singleWidget.type === ARTEFACT_WIDGET_TYPE
		) {
			editor.setEditingShape( singleShape.id );
			return;
		}

		if ( ! desk.siteId ) {
			return;
		}

		if ( singleWidget.type === POST_WIDGET_TYPE && singleWidget.widgetProps.postId > 0 ) {
			void connector.openSiteUrl(
				desk.siteId,
				`/wp-admin/post.php?post=${ singleWidget.widgetProps.postId }&action=edit`
			);
			return;
		}

		if ( singleWidget.type === PAGE_WIDGET_TYPE && singleWidget.widgetProps.pageId > 0 ) {
			void connector.openSiteUrl(
				desk.siteId,
				`/wp-admin/post.php?post=${ singleWidget.widgetProps.pageId }&action=edit`
			);
			return;
		}

		if ( singleWidget.type === POST_COLLECTION_WIDGET_TYPE ) {
			void connector.openSiteUrl( desk.siteId, '/wp-admin/edit.php' );
		}
	}

	function duplicateSelection() {
		const originalStackIds = getStackIdsForShapeIds( editor, state.shapeIds );
		editor.duplicateShapes( state.shapeIds, { x: 24, y: 24 } );

		if ( originalStackIds.size === 0 ) {
			return;
		}

		const replacementStackIds = new Map(
			Array.from( originalStackIds, ( originalStackId ) => [ originalStackId, createStackId() ] )
		);
		const duplicatedStackShapes = editor
			.getSelectedShapeIds()
			.map( ( shapeId ) => editor.getShape( shapeId ) )
			.filter( ( shape ): shape is TLShape => Boolean( shape ) )
			.map( ( shape ) => {
				const originalStackId = getStackId( shape );
				const nextStackId = originalStackId
					? replacementStackIds.get( originalStackId )
					: undefined;

				if ( ! nextStackId ) {
					return null;
				}

				return {
					id: shape.id,
					type: shape.type,
					meta: {
						...( shape.meta ?? {} ),
						deskStackId: nextStackId,
					},
				};
			} )
			.filter( ( partial ): partial is NonNullable< typeof partial > => partial !== null );

		if ( duplicatedStackShapes.length > 0 ) {
			editor.updateShapes( duplicatedStackShapes );
		}
	}
}

function ExistingContentPickerMenuItems( {
	type,
	canAddWidgets,
	isLoadingSites,
	hasSite,
	canQueryPosts,
	onBack,
	onSelect,
}: {
	type: 'post' | 'page';
	canAddWidgets: boolean;
	isLoadingSites: boolean;
	hasSite: boolean;
	canQueryPosts: boolean;
	onBack: () => void;
	onSelect: ( id: number ) => void;
} ) {
	const query = useMemo(
		() => ( {
			per_page: 20,
			context: 'view',
			orderby: type === 'page' ? 'menu_order' : 'date',
			order: type === 'page' ? 'asc' : 'desc',
			_fields: 'id,title,excerpt,status,date,link,slug',
		} ),
		[ type ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< CoreDataPost >( 'postType', type, query, {
		enabled: canQueryPosts,
	} );

	return (
		<>
			<ContextMenuBackItem onClick={ onBack } />
			<ContextMenuSeparator />
			{ isLoadingSites && <div className={ styles.status }>{ __( 'Checking site…' ) }</div> }
			{ ! isLoadingSites && ! hasSite && (
				<div className={ styles.status }>{ __( 'Site not found.' ) }</div>
			) }
			{ hasSite && ! canQueryPosts && (
				<div className={ styles.status }>{ __( 'Site is not running.' ) }</div>
			) }
			{ canQueryPosts && isResolving && ! records && (
				<div className={ styles.status }>
					{ type === 'page' ? __( 'Loading pages…' ) : __( 'Loading posts…' ) }
				</div>
			) }
			{ canQueryPosts && records && records.length === 0 && (
				<div className={ styles.status }>
					{ type === 'page' ? __( 'No pages found.' ) : __( 'No posts found.' ) }
				</div>
			) }
			{ canQueryPosts && resolutionStatus === 'ERROR' && (
				<div className={ styles.status }>
					{ type === 'page' ? __( 'Unable to load pages.' ) : __( 'Unable to load posts.' ) }
				</div>
			) }
			{ records?.map( ( record ) => {
				const title = decodeEntities( record.title?.rendered ?? '' ).trim() || __( 'Untitled' );
				return (
					<ContextMenuItem
						key={ record.id }
						className={ styles.postPickerItem }
						disabled={ ! canAddWidgets }
						onClick={ () => onSelect( record.id ) }
					>
						<span className={ styles.postPickerTitle }>{ title }</span>
						{ record.status && <span className={ styles.postPickerMeta }>{ record.status }</span> }
					</ContextMenuItem>
				);
			} ) }
		</>
	);
}

function ContextMenuItem( {
	children,
	active = false,
	disabled = false,
	className,
	onClick,
}: {
	children: ReactNode;
	active?: boolean;
	disabled?: boolean;
	className?: string;
	onClick: ( event: MouseEvent< HTMLButtonElement > ) => void;
} ) {
	return (
		<button
			type="button"
			className={ clsx( styles.item, className ) }
			role="menuitem"
			disabled={ disabled }
			data-active={ active ? 'true' : undefined }
			onClick={ onClick }
		>
			{ children }
		</button>
	);
}

function ChatMenuItem( { disabled, onClick }: { disabled: boolean; onClick: () => void } ) {
	return (
		<ContextMenuItem disabled={ disabled } onClick={ onClick }>
			<span>{ __( 'Start conversation…' ) }</span>
			<span className={ styles.chatIcon } aria-hidden="true">
				<Icon icon={ comment } size={ 20 } />
			</span>
		</ContextMenuItem>
	);
}

function ContextMenuBackItem( { onClick }: { onClick: () => void } ) {
	return (
		<ContextMenuItem className={ styles.backItem } onClick={ onClick }>
			<Icon icon={ chevronLeft } />
			<span>{ __( 'Back' ) }</span>
		</ContextMenuItem>
	);
}

function ContextMenuSeparator() {
	return <div className={ styles.separator } role="separator" />;
}

function getMenuPosition( state: DeskContextMenuState, menuMode: MenuMode ) {
	if ( typeof window === 'undefined' ) {
		return {
			left: state.x,
			top: state.y,
		};
	}

	const width = menuMode === 'pick-post' || menuMode === 'pick-page' ? PICKER_WIDTH : MENU_WIDTH;
	return {
		left: Math.max(
			VIEWPORT_MARGIN,
			Math.min( state.x, window.innerWidth - width - VIEWPORT_MARGIN )
		),
		top: Math.max(
			VIEWPORT_MARGIN,
			Math.min( state.y, window.innerHeight - MENU_MAX_HEIGHT - VIEWPORT_MARGIN )
		),
	};
}

function getSelectionStackId( editor: Editor, shapeIds: TLShapeId[] ) {
	if ( shapeIds.length < 2 ) {
		return null;
	}

	const stackIds = new Set< string >();
	for ( const shapeId of shapeIds ) {
		const stackId = getStackId( editor.getShape( shapeId ) );
		if ( ! stackId ) {
			return null;
		}
		stackIds.add( stackId );
	}

	return stackIds.size === 1 ? stackIds.values().next().value : null;
}

function getStackIdsForShapeIds( editor: Editor, shapeIds: TLShapeId[] ) {
	const stackIds = new Set< string >();
	for ( const shapeId of shapeIds ) {
		const stackId = getStackId( editor.getShape( shapeId ) );
		if ( stackId ) {
			stackIds.add( stackId );
		}
	}
	return stackIds;
}

function getWidgetsForShapeIds( editor: Editor, shapeIds: TLShapeId[] ) {
	return shapeIds
		.map( ( shapeId ) => editor.getShape( shapeId ) )
		.map( ( shape ) => ( shape ? canvasShapeToDeskWidget( shape ) : null ) )
		.filter( ( widget ): widget is DeskWidget => widget !== null );
}

function canEditWidget(
	widget: DeskWidget,
	{ hasRunningSite, hasSiteId }: { hasRunningSite: boolean; hasSiteId: boolean }
) {
	if (
		widget.type === NOTE_WIDGET_TYPE ||
		widget.type === SITE_PREVIEW_WIDGET_TYPE ||
		widget.type === ARTEFACT_WIDGET_TYPE
	) {
		return true;
	}

	if ( ! hasSiteId || ! hasRunningSite ) {
		return false;
	}

	if ( widget.type === POST_WIDGET_TYPE ) {
		return widget.widgetProps.postId > 0;
	}

	if ( widget.type === PAGE_WIDGET_TYPE ) {
		return widget.widgetProps.pageId > 0;
	}

	return widget.type === POST_COLLECTION_WIDGET_TYPE;
}

function isWidgetAvailableInDeskContext(
	definition: DeskWidgetDefinition,
	hasSiteContext: boolean
) {
	return hasSiteContext || ! definition.requiresRunningSite;
}

function isWidgetCreationDisabled(
	definition: DeskWidgetDefinition,
	canAddWidgets: boolean,
	isSiteRunning: boolean
) {
	return ! canAddWidgets || ( definition.requiresRunningSite && ! isSiteRunning );
}
