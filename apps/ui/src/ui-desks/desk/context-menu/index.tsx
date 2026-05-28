import { useRegistry } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import {
	category,
	chevronLeft,
	chevronRight,
	comment,
	connection,
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
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { SelectionChatDialog } from '@/ui-desks/chats/selection-chat-dialog';
import { LinkFromUrlDialog } from '@/ui-desks/chrome/link-from-url-dialog';
import { appendIncomingConnectedWidgets } from '@/ui-desks/connectors/context';
import { canvasShapeToDeskWidget } from '@/ui-desks/desk/tldraw-adapter';
import { collapseStackInEditor, expandStackInEditor } from '@/ui-desks/stacks/editor-commands';
import { createStackId, getStackId, isStackExpanded } from '@/ui-desks/stacks/utils';
import {
	isWidgetAvailableInDeskContext,
	isWidgetCreationDisabled,
} from '@/ui-desks/widget-actions/availability';
import { getCreateWidgetOptions } from '@/ui-desks/widget-actions/create-widget-options';
import { getWidgetEditAction } from '@/ui-desks/widget-actions/edit-action';
import {
	getExistingContentWidgetProps,
	getExistingContentWidgetType,
	useExistingContentPicker,
	type ExistingContentType,
} from '@/ui-desks/widget-actions/existing-content-picker';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { getCreatableWidgetDefinitions, getWidgetDefinition } from '@/ui-desks/widgets/registry';
import { siteCardWidgetDefinition } from '@/ui-desks/widgets/site-card/definition';
import { getThemePatterns, getThemeTemplates } from '@/ui-desks/widgets/theme/api';
import { themeWidgetDefinition } from '@/ui-desks/widgets/theme/definition';
import {
	createThemePatternBrowserMaterialization,
	themePatternBrowserWidgetDefinition,
} from '@/ui-desks/widgets/theme-pattern-browser/definition';
import {
	createThemeTemplateBrowserMaterialization,
	themeTemplateBrowserWidgetDefinition,
} from '@/ui-desks/widgets/theme-template-browser/definition';
import { useDesk } from '../provider';
import styles from './style.module.css';
import type { DeskContextMenuState } from './state';
import type { SiteDetails } from '@/data/core';
import type { DeskWidget, DeskWidgetDefinition } from '@/ui-desks/widgets/types';
import type { Editor, TLShape, TLShapeId } from 'tldraw';

type MenuMode = 'main' | 'show-as' | 'insert' | 'pick-post' | 'pick-page' | 'pick-site-card';

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
	const registry = useRegistry();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === desk.siteId );
	const isSiteRunning = Boolean( site?.running );
	const singleShape =
		state.kind === 'single' && state.shapeIds[ 0 ] ? editor.getShape( state.shapeIds[ 0 ] ) : null;
	const singleWidget = singleShape ? canvasShapeToDeskWidget( singleShape ) : null;
	const singleDefinition = singleWidget ? getWidgetDefinition( singleWidget.type ) : undefined;
	const singleEditAction =
		singleWidget && singleDefinition
			? getWidgetEditAction( singleDefinition, singleWidget, {
					hasSiteId: Boolean( desk.siteId ),
					hasRunningSite: isSiteRunning,
			  } )
			: null;
	const [ menuMode, setMenuMode ] = useState< MenuMode >( 'main' );
	const [ isLinkDialogOpen, setIsLinkDialogOpen ] = useState( false );
	const [ chatWidgets, setChatWidgets ] = useState< DeskWidget[] | null >( null );
	const creatableWidgetDefinitions = getCreatableWidgetDefinitions().filter( ( definition ) =>
		isWidgetAvailableInDeskContext( definition, Boolean( desk.siteId ) )
	);
	const canEditSingle = Boolean( singleShape && singleEditAction );
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

			if ( menuMode === 'pick-post' || menuMode === 'pick-page' || menuMode === 'pick-site-card' ) {
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
	const addCreatableWidget = async (
		definition: ReturnType< typeof getCreatableWidgetDefinitions >[ number ]
	) => {
		desk.addWidget(
			definition.type,
			await getCreateWidgetOptions( definition, registry, {
				center: state.pagePoint,
				shouldStartEditing: definition.shouldStartEditingOnCreate,
			} )
		);
	};
	const addPatternBrowser = async () => {
		const patterns = await getThemePatterns( { registry } );
		desk.addMaterializedDesk(
			( context ) => createThemePatternBrowserMaterialization( context, patterns ),
			{ center: state.pagePoint }
		);
	};
	const addTemplateBrowser = async () => {
		const templates = await getThemeTemplates( { registry } );
		desk.addMaterializedDesk(
			( context ) => createThemeTemplateBrowserMaterialization( context, templates ),
			{ center: state.pagePoint }
		);
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
					( menuMode === 'pick-post' ||
						menuMode === 'pick-page' ||
						menuMode === 'pick-site-card' ) &&
						styles.picker
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
								<span>{ singleDefinition?.labels.fitContent?.() ?? __( 'Fit to size' ) }</span>
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
							onClick={ () =>
								setChatWidgets(
									appendIncomingConnectedWidgets( selectedWidgets, desk.getDeskConfigSnapshot() )
								)
							}
						/>
						<ContextMenuItem
							disabled={ ! desk.canAddWidgets || ! singleWidget || ! singleShape }
							onClick={ () =>
								closeAfter( () => {
									if ( singleShape ) {
										desk.startConnectingWidget( singleShape.id );
									}
								} )
							}
						>
							<span>{ __( 'Connect…' ) }</span>
							<Icon icon={ connection } />
						</ContextMenuItem>
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
							onClick={ () =>
								setChatWidgets(
									appendIncomingConnectedWidgets( selectedWidgets, desk.getDeskConfigSnapshot() )
								)
							}
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
							onClick={ () =>
								setChatWidgets(
									appendIncomingConnectedWidgets( selectedWidgets, desk.getDeskConfigSnapshot() )
								)
							}
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
							<CreateWidgetContextMenuItems
								key={ definition.type }
								definition={ definition }
								canAddWidgets={ desk.canAddWidgets }
								isSiteRunning={ isSiteRunning }
								onClick={ () => closeAfter( () => addCreatableWidget( definition ) ) }
							>
								{ definition.type === themeWidgetDefinition.type && (
									<>
										<CreateWidgetContextMenuItems
											definition={ themePatternBrowserWidgetDefinition }
											canAddWidgets={ desk.canAddWidgets }
											isSiteRunning={ isSiteRunning }
											onClick={ () => closeAfter( addPatternBrowser ) }
										/>
										<CreateWidgetContextMenuItems
											definition={ themeTemplateBrowserWidgetDefinition }
											canAddWidgets={ desk.canAddWidgets }
											isSiteRunning={ isSiteRunning }
											onClick={ () => closeAfter( addTemplateBrowser ) }
										/>
									</>
								) }
							</CreateWidgetContextMenuItems>
						) ) }
						{ desk.siteId ? (
							<ContextMenuItem
								disabled={ ! desk.canAddWidgets }
								onClick={ () =>
									closeAfter( () => {
										desk.addWidget( siteCardWidgetDefinition.type, {
											center: state.pagePoint,
											shouldStartEditing: false,
										} );
									} )
								}
							>
								{ siteCardWidgetDefinition.icon && <Icon icon={ siteCardWidgetDefinition.icon } /> }
								<span>{ siteCardWidgetDefinition.labels.add() }</span>
							</ContextMenuItem>
						) : (
							<ContextMenuItem
								disabled={ ! desk.canAddWidgets || ! sites?.length }
								onClick={ () => setMenuMode( 'pick-site-card' ) }
							>
								{ siteCardWidgetDefinition.icon && <Icon icon={ siteCardWidgetDefinition.icon } /> }
								<span>{ siteCardWidgetDefinition.labels.add() }</span>
								<Icon icon={ chevronRight } />
							</ContextMenuItem>
						) }
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
						siteId={ desk.siteId }
						canAddWidgets={ desk.canAddWidgets }
						onBack={ () => setMenuMode( 'insert' ) }
						onSelect={ ( id ) =>
							closeAfter( () => {
								const type = menuMode === 'pick-page' ? 'page' : 'post';
								desk.addWidget( getExistingContentWidgetType( type ), {
									center: state.pagePoint,
									widgetProps: getExistingContentWidgetProps( type, id ),
									shouldStartEditing: false,
								} );
							} )
						}
					/>
				) }
				{ state.kind === 'empty' && menuMode === 'pick-site-card' && (
					<SiteCardPickerContextMenuItems
						canAddWidgets={ desk.canAddWidgets }
						onBack={ () => setMenuMode( 'insert' ) }
						onSelect={ ( selectedSiteId ) =>
							closeAfter( () => {
								desk.addWidget( siteCardWidgetDefinition.type, {
									center: state.pagePoint,
									widgetProps: {
										siteId: selectedSiteId,
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
		if ( ! singleShape || ! singleEditAction ) {
			return;
		}

		if ( singleEditAction.kind === 'canvas-editing' ) {
			editor.setEditingShape( singleShape.id );
			return;
		}

		if ( desk.siteId ) {
			void connector.openSiteUrl( desk.siteId, singleEditAction.path );
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
	siteId,
	canAddWidgets,
	onBack,
	onSelect,
}: {
	type: ExistingContentType;
	siteId?: string;
	canAddWidgets: boolean;
	onBack: () => void;
	onSelect: ( id: number ) => void;
} ) {
	const { items, statusMessage } = useExistingContentPicker( { type, siteId } );

	return (
		<>
			<ContextMenuBackItem onClick={ onBack } />
			<ContextMenuSeparator />
			{ statusMessage && <div className={ styles.status }>{ statusMessage }</div> }
			{ items?.map( ( item ) => {
				return (
					<ContextMenuItem
						key={ item.id }
						className={ styles.postPickerItem }
						disabled={ ! canAddWidgets }
						onClick={ () => onSelect( item.id ) }
					>
						<span className={ styles.postPickerContent }>
							<span className={ styles.postPickerTitle }>{ item.title }</span>
							{ item.status && (
								<span className={ styles.postPickerMeta }>{ item.statusInfo.label }</span>
							) }
						</span>
						{ item.status && (
							<span
								className={ styles.postPickerStatusDot }
								style={ { background: item.statusInfo.color } }
								title={ item.statusInfo.label }
								aria-label={ item.statusInfo.label }
							/>
						) }
					</ContextMenuItem>
				);
			} ) }
		</>
	);
}

function SiteCardPickerContextMenuItems( {
	canAddWidgets,
	onBack,
	onSelect,
}: {
	canAddWidgets: boolean;
	onBack: () => void;
	onSelect: ( siteId: string ) => void;
} ) {
	const { data: sites, isLoading } = useSites();

	return (
		<>
			<ContextMenuBackItem onClick={ onBack } />
			<ContextMenuSeparator />
			{ isLoading && <div className={ styles.status }>{ __( 'Loading sites…' ) }</div> }
			{ ! isLoading && ! sites?.length && (
				<div className={ styles.status }>{ __( 'No sites available.' ) }</div>
			) }
			{ sites?.map( ( site ) => (
				<ContextMenuItem
					key={ site.id }
					className={ styles.sitePickerItem }
					disabled={ ! canAddWidgets }
					onClick={ () => onSelect( site.id ) }
				>
					<SiteCardPickerSite site={ site } />
				</ContextMenuItem>
			) ) }
		</>
	);
}

function SiteCardPickerSite( { site }: { site: SiteDetails } ) {
	return (
		<>
			<SiteIcon
				className={ styles.sitePickerIcon }
				seed={ `${ site.id }:${ site.name }:${ site.path }` }
				imageSrc={ site.siteIcon }
			/>
			<span className={ styles.postPickerContent }>
				<span className={ styles.postPickerTitle }>{ site.name }</span>
				<span className={ styles.postPickerMeta }>
					{ site.running ? __( 'Running' ) : __( 'Stopped' ) }
				</span>
			</span>
		</>
	);
}

function CreateWidgetContextMenuItems( {
	definition,
	canAddWidgets,
	isSiteRunning,
	onClick,
	children,
}: {
	definition: DeskWidgetDefinition;
	canAddWidgets: boolean;
	isSiteRunning: boolean;
	onClick: () => void;
	children?: ReactNode;
} ) {
	return (
		<>
			<ContextMenuItem
				disabled={ isWidgetCreationDisabled( definition, canAddWidgets, isSiteRunning ) }
				onClick={ onClick }
			>
				{ definition.icon && <Icon icon={ definition.icon } /> }
				<span>{ definition.labels.add() }</span>
			</ContextMenuItem>
			{ children }
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
	const boundary = state.boundary;
	if ( typeof window === 'undefined' && ! boundary ) {
		return {
			left: state.x,
			top: state.y,
		};
	}

	const width =
		menuMode === 'pick-post' || menuMode === 'pick-page' || menuMode === 'pick-site-card'
			? PICKER_WIDTH
			: MENU_WIDTH;
	const maxWidth = boundary?.width ?? window.innerWidth;
	const maxHeight = boundary?.height ?? window.innerHeight;
	return {
		left: Math.max( VIEWPORT_MARGIN, Math.min( state.x, maxWidth - width - VIEWPORT_MARGIN ) ),
		top: Math.max(
			VIEWPORT_MARGIN,
			Math.min( state.y, maxHeight - MENU_MAX_HEIGHT - VIEWPORT_MARGIN )
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
