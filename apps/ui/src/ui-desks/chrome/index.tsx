import { moveDeskToolbarButton } from '@studio/common/lib/desk-settings';
import { __, _n, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { ChatsTrigger } from '../chats';
import { DeskCreateMenu } from './create-menu';
import { DeskSettingsButton } from './settings-button';
import { DeskSiteMapButton } from './site-map-button';
import styles from './style.module.css';
import { DeskMenu } from './user-menu';
import type {
	DeskSettings,
	DeskToolbarButtonId,
	DeskToolbarLayout,
} from '@studio/common/types/desk';
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';

interface DeskHeaderProps {
	children: ReactNode;
	centerChildren?: ReactNode;
	rightChildren?: ReactNode;
}

export function DeskHeader( { children, centerChildren, rightChildren }: DeskHeaderProps ) {
	const isFullscreen = useFullscreen();

	return (
		<div className={ clsx( styles.root, isFullscreen && styles.fullscreen ) }>
			<span className={ styles.title }>{ __( 'Studio' ) }</span>
			<div className={ styles.actions }>{ children }</div>
			{ centerChildren && <div className={ styles.centerActions }>{ centerChildren }</div> }
			{ rightChildren && <div className={ styles.rightActions }>{ rightChildren }</div> }
		</div>
	);
}

interface DeskChromeProps {
	siteId?: string;
	siteMapOpen?: boolean;
	siteMapPageCount?: number;
	settings: DeskSettings;
	settingsOpen: boolean;
	editingToolbar: boolean;
	onToggleSiteMap?: () => void;
	onToggleSettings: () => void;
	onChangeToolbarLayout: ( layout: DeskToolbarLayout ) => void;
}

export function DeskChrome( {
	siteId,
	siteMapOpen = false,
	siteMapPageCount,
	settings,
	settingsOpen,
	editingToolbar,
	onToggleSiteMap,
	onToggleSettings,
	onChangeToolbarLayout,
}: DeskChromeProps ) {
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
		onChangeToolbarLayout(
			moveDeskToolbarButton( settings.toolbarLayout, buttonId, side, beforeButtonId )
		);
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
					<DeskMenu
						siteId={ siteId }
						disabled={ editingToolbar }
						showSiteName={ settings.showSiteName }
					/>
				}
			/>
		</DeskHeader>
	);
}

const DRAG_MIME = 'application/x-studio-desk-toolbar-button';

interface ToolbarDragState {
	draggedId: DeskToolbarButtonId | null;
	insertBeforeId: DeskToolbarButtonId | null;
	insertSide: keyof DeskToolbarLayout | null;
}

const EMPTY_DRAG_STATE: ToolbarDragState = {
	draggedId: null,
	insertBeforeId: null,
	insertSide: null,
};

interface ToolbarRowProps {
	side: keyof DeskToolbarLayout;
	buttonIds: DeskToolbarButtonId[];
	editing: boolean;
	renderButton: ( buttonId: DeskToolbarButtonId ) => ReactNode;
	onReorder: (
		buttonId: DeskToolbarButtonId,
		side: keyof DeskToolbarLayout,
		beforeButtonId: DeskToolbarButtonId | null
	) => void;
	dragState: ToolbarDragState;
	setDragState: Dispatch< SetStateAction< ToolbarDragState > >;
	clearDragState: () => void;
	leading?: ReactNode;
}

function ToolbarRow( {
	side,
	buttonIds,
	editing,
	renderButton,
	onReorder,
	dragState,
	setDragState,
	clearDragState,
	leading,
}: ToolbarRowProps ) {
	const rowRef = useRef< HTMLDivElement | null >( null );

	const getInsertionTarget = ( clientX: number ) => {
		const row = rowRef.current;
		if ( ! row ) {
			return null;
		}

		const slots = row.querySelectorAll< HTMLElement >( `[data-toolbar-button-id]` );
		for ( const slot of slots ) {
			if ( slot.dataset.dragging === 'true' ) {
				continue;
			}

			const id = slot.dataset.toolbarButtonId as DeskToolbarButtonId | undefined;
			if ( ! id ) {
				continue;
			}

			const rect = slot.getBoundingClientRect();
			if ( clientX < rect.left + rect.width / 2 ) {
				return id;
			}
		}

		return null;
	};

	const onDragStart = ( event: DragEvent, buttonId: DeskToolbarButtonId ) => {
		event.dataTransfer.setData( DRAG_MIME, buttonId );
		event.dataTransfer.effectAllowed = 'move';
		window.setTimeout( () => {
			setDragState( { draggedId: buttonId, insertBeforeId: null, insertSide: null } );
		}, 0 );
	};

	const onDragOver = ( event: DragEvent ) => {
		if ( ! editing || ! event.dataTransfer.types.includes( DRAG_MIME ) ) {
			return;
		}

		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const insertBeforeId = getInsertionTarget( event.clientX );
		setDragState( ( previous ) =>
			previous.insertBeforeId === insertBeforeId && previous.insertSide === side
				? previous
				: { ...previous, insertBeforeId, insertSide: side }
		);
	};

	const onDrop = ( event: DragEvent ) => {
		if ( ! editing ) {
			return;
		}

		const buttonId = event.dataTransfer.getData( DRAG_MIME ) as DeskToolbarButtonId;
		if ( ! buttonId ) {
			return;
		}

		event.preventDefault();
		onReorder( buttonId, side, getInsertionTarget( event.clientX ) );
		clearDragState();
	};

	const isTarget = dragState.insertSide === side;
	const slots: ReactNode[] = [];
	let ghostInserted = false;

	for ( const buttonId of buttonIds ) {
		const button = renderButton( buttonId );
		if ( ! button ) {
			continue;
		}

		if (
			isTarget &&
			! ghostInserted &&
			dragState.insertBeforeId === buttonId &&
			dragState.draggedId !== buttonId
		) {
			slots.push( <DropGhost key="__ghost" /> );
			ghostInserted = true;
		}

		const isDragged = dragState.draggedId === buttonId;
		slots.push(
			<div
				key={ buttonId }
				className={ styles.toolbarSlot }
				data-toolbar-button-id={ buttonId }
				data-dragging={ isDragged ? 'true' : 'false' }
				draggable={ editing }
				onDragStart={ ( event ) => onDragStart( event, buttonId ) }
				onDragEnd={ clearDragState }
			>
				{ button }
			</div>
		);
	}

	if ( isTarget && ! ghostInserted ) {
		slots.push( <DropGhost key="__ghost" /> );
	}

	return (
		<div
			ref={ rowRef }
			className={ styles.toolbarRow }
			data-side={ side }
			data-editing={ editing ? 'true' : 'false' }
			onDragOver={ onDragOver }
			onDrop={ onDrop }
		>
			{ leading }
			{ slots }
		</div>
	);
}

function DropGhost() {
	return <div className={ clsx( styles.toolbarSlot, styles.toolbarDropGhost ) } aria-hidden />;
}

function DeskSiteMapTitle( { pageCount }: { pageCount?: number } ) {
	return (
		<div className={ styles.siteMapTitle }>
			<h1>{ __( 'Site map' ) }</h1>
			{ pageCount !== undefined && (
				<span>{ sprintf( _n( '%d page', '%d pages', pageCount ), pageCount ) }</span>
			) }
		</div>
	);
}
