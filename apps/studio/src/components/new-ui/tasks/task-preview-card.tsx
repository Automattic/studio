import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from 'src/lib/cx';
import type { TaskMetadata } from 'src/modules/ai/types';

const CARD_WIDTH = 260;
const VIEWPORT_PADDING = 8;

interface TaskPreviewCardProps {
	task: TaskMetadata;
	visible: boolean;
	mouseX: number;
	mouseY: number;
}

function formatRelativeTime( timestamp: number ): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor( diff / 1000 );
	const minutes = Math.floor( seconds / 60 );
	const hours = Math.floor( minutes / 60 );
	const days = Math.floor( hours / 24 );

	if ( days > 7 ) {
		return new Date( timestamp ).toLocaleDateString( undefined, {
			month: 'short',
			day: 'numeric',
		} );
	}
	if ( days > 0 ) {
		return `${ days }d ago`;
	}
	if ( hours > 0 ) {
		return `${ hours }h ago`;
	}
	if ( minutes > 0 ) {
		return `${ minutes }m ago`;
	}
	return 'Just now';
}

function formatCreatedDate( timestamp: number ): string {
	return new Date( timestamp ).toLocaleString( undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	} );
}

export function TaskPreviewCard( { task, visible, mouseX, mouseY }: TaskPreviewCardProps ) {
	const cardRef = useRef< HTMLDivElement >( null );
	const [ cardHeight, setCardHeight ] = useState( 0 );
	const [ show, setShow ] = useState( false );

	useEffect( () => {
		if ( visible && cardRef.current ) {
			setCardHeight( cardRef.current.offsetHeight );
		}
	}, [ visible, task.summary ] );

	useEffect( () => {
		if ( visible ) {
			requestAnimationFrame( () => setShow( true ) );
		} else {
			setShow( false );
		}
	}, [ visible ] );

	const position = useMemo( () => {
		let left = mouseX + 16;
		let top = mouseY - 8;

		if ( left + CARD_WIDTH > window.innerWidth - VIEWPORT_PADDING ) {
			left = mouseX - CARD_WIDTH - 8;
		}

		const height = cardHeight || 120;
		if ( top + height > window.innerHeight - VIEWPORT_PADDING ) {
			top = window.innerHeight - height - VIEWPORT_PADDING;
		}
		top = Math.max( VIEWPORT_PADDING, top );
		left = Math.max( VIEWPORT_PADDING, left );

		return { top, left };
	}, [ mouseX, mouseY, cardHeight ] );

	if ( ! visible && ! show ) {
		return null;
	}

	return createPortal(
		<div
			ref={ cardRef }
			className={ cx(
				'fixed z-50 pointer-events-none',
				'flex flex-col gap-2 p-3',
				'rounded-lg border border-chrome-border bg-chrome shadow-lg',
				'transition-opacity duration-100 ease-out',
				show ? 'opacity-100' : 'opacity-0'
			) }
			style={ {
				width: CARD_WIDTH,
				top: position.top,
				left: position.left,
			} }
		>
			<div className="text-sm font-medium text-chrome-text leading-snug">{ task.title }</div>

			<div className="flex flex-col gap-0.5 text-[11px]">
				<div className="flex items-baseline gap-1.5">
					<span className="text-chrome-text-tertiary">Updated</span>
					<span className="text-chrome-text-secondary">
						{ formatRelativeTime( task.updatedAt ) }
					</span>
				</div>
				<div className="flex items-baseline gap-1.5">
					<span className="text-chrome-text-tertiary">Created</span>
					<span className="text-chrome-text-secondary">
						{ formatCreatedDate( task.createdAt ) }
					</span>
				</div>
			</div>

			{ task.summary && (
				<div className="pt-1.5 border-t border-chrome-border">
					<p className="text-xs text-chrome-text-secondary leading-relaxed line-clamp-4">
						{ task.summary }
					</p>
				</div>
			) }
		</div>,
		document.body
	);
}
