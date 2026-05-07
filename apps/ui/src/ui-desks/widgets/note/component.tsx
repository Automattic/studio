import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import {
	getPointerInfo,
	stopEventPropagation,
	useEditor,
	useIsEditing,
	type TLUnknownShape,
} from 'tldraw';
import { NOTE_WIDGET_TYPE, type NoteWidgetProps } from '@/ui-desks/widgets/note/types';
import styles from './style.module.css';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type NoteWidgetComponentProps = DeskWidgetComponentProps< NoteWidgetProps >;

export function NoteWidgetComponent( { id, shapeType, widgetProps }: NoteWidgetComponentProps ) {
	const editor = useEditor();
	const isEditing = useIsEditing( id );
	const textareaRef = useRef< HTMLTextAreaElement >( null );

	useEffect( () => {
		if ( ! isEditing ) {
			return;
		}

		const frame = window.requestAnimationFrame( () => {
			const textarea = textareaRef.current;
			if ( ! textarea ) {
				return;
			}

			textarea.focus();
			textarea.select();
		} );

		return () => {
			window.cancelAnimationFrame( frame );
		};
	}, [ isEditing ] );

	const updateText = useCallback(
		( text: string ) => {
			if ( editor.getEditingShapeId() !== id ) {
				return;
			}

			editor.updateShape< TLUnknownShape >( {
				id,
				type: shapeType,
				props: {
					widgetProps: {
						...widgetProps,
						text,
					},
				},
			} );
		},
		[ editor, id, shapeType, widgetProps ]
	);

	const handlePointerDown = useCallback(
		( event: PointerEvent< HTMLTextAreaElement > ) => {
			const shape = editor.getShape( id );
			if ( shape ) {
				editor.dispatch( {
					...getPointerInfo( event ),
					type: 'pointer',
					name: 'pointer_down',
					target: 'shape',
					shape,
				} );
			}

			stopEventPropagation( event );
		},
		[ editor, id ]
	);

	const handleKeyDown = useCallback(
		( event: KeyboardEvent< HTMLTextAreaElement > ) => {
			event.stopPropagation();

			if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
				event.preventDefault();
				editor.complete();
			}
		},
		[ editor ]
	);

	return (
		<div
			className={ styles.note }
			data-color={ widgetProps.color }
			data-is-editing={ isEditing }
			data-studio-desk-widget={ NOTE_WIDGET_TYPE }
		>
			{ isEditing ? (
				<textarea
					ref={ textareaRef }
					className={ styles.textarea }
					value={ widgetProps.text }
					spellCheck
					onChange={ ( event ) => updateText( event.currentTarget.value ) }
					onKeyDown={ handleKeyDown }
					onPointerDown={ handlePointerDown }
					onBlur={ () => editor.complete() }
				/>
			) : widgetProps.text ? (
				<div className={ styles.text }>{ widgetProps.text }</div>
			) : (
				<div className={ styles.placeholder }>Type a note...</div>
			) }
		</div>
	);
}
