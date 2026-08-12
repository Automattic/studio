import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import styles from './style.module.css';
import type { IndicatorPreviewChoice } from './context';

const OPTIONS: { value: IndicatorPreviewChoice; label: string }[] = [
	{ value: 'auto', label: 'Live app state' },
	{ value: 'off', label: 'Hidden' },
	{ value: 'working', label: 'Working' },
];

export function IndicatorPlaygroundControls( {
	sidebar,
	conversation,
	setSidebar,
	setConversation,
}: {
	sidebar: IndicatorPreviewChoice;
	conversation: IndicatorPreviewChoice;
	setSidebar: ( value: IndicatorPreviewChoice ) => void;
	setConversation: ( value: IndicatorPreviewChoice ) => void;
} ) {
	const [ position, setPosition ] = useState( { x: 20, y: 20 } );
	const dragRef = useRef< { x: number; y: number; left: number; top: number } | null >( null );

	const handlePointerDown = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		event.currentTarget.setPointerCapture( event.pointerId );
		dragRef.current = {
			x: event.clientX,
			y: event.clientY,
			left: position.x,
			top: position.y,
		};
	};
	const handlePointerMove = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		if ( ! dragRef.current ) {
			return;
		}
		setPosition( {
			x: Math.max( 0, dragRef.current.left + event.clientX - dragRef.current.x ),
			y: Math.max( 0, dragRef.current.top + event.clientY - dragRef.current.y ),
		} );
	};

	return (
		<aside className={ styles.panel } style={ { left: position.x, top: position.y } }>
			<div
				className={ styles.handle }
				onPointerDown={ handlePointerDown }
				onPointerMove={ handlePointerMove }
				onPointerUp={ () => ( dragRef.current = null ) }
			>
				<span>Indicator lab</span>
				<span aria-hidden="true">⋮⋮</span>
			</div>
			<label>
				<span>Selected sidebar site</span>
				<select
					value={ sidebar }
					onChange={ ( event ) => setSidebar( event.target.value as IndicatorPreviewChoice ) }
				>
					{ OPTIONS.map( ( option ) => (
						<option key={ option.value } value={ option.value }>
							{ option.label }
						</option>
					) ) }
				</select>
			</label>
			<label>
				<span>Conversation</span>
				<select
					value={ conversation }
					onChange={ ( event ) => setConversation( event.target.value as IndicatorPreviewChoice ) }
				>
					{ OPTIONS.map( ( option ) => (
						<option key={ option.value } value={ option.value }>
							{ option.label }
						</option>
					) ) }
				</select>
			</label>
			<button
				type="button"
				onClick={ () => {
					setSidebar( 'auto' );
					setConversation( 'auto' );
				} }
			>
				Reset
			</button>
		</aside>
	);
}
