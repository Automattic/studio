import { clsx } from 'clsx';
import { useRef } from 'react';
import styles from './style.module.css';
import type { DeskToolbarButtonId, DeskToolbarLayout } from '@/ui-desks/chrome/toolbar-layout';
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';

const DRAG_MIME = 'application/x-studio-desk-toolbar-button';

export interface ToolbarDragState {
	draggedId: DeskToolbarButtonId | null;
	insertBeforeId: DeskToolbarButtonId | null;
	insertSide: keyof DeskToolbarLayout | null;
}

export const EMPTY_DRAG_STATE: ToolbarDragState = {
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

export function ToolbarRow( {
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
