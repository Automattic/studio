import { create, registerFormatType, toHTMLString } from '@wordpress/rich-text';
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditor, useIsEditing, type TLUnknownShape } from 'tldraw';
import { NOTE_WIDGET_TYPE, type NoteWidgetProps } from '@/ui-desks/widgets/note/types';
import styles from './style.module.css';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type NoteWidgetComponentProps = DeskWidgetComponentProps< NoteWidgetProps >;

registerCoreFormats();

export function NoteWidgetComponent( { id, shapeType, widgetProps }: NoteWidgetComponentProps ) {
	const editor = useEditor();
	const isEditing = useIsEditing( id );
	const editorRef = useRef< HTMLDivElement >( null );

	useEffect( () => {
		const noteEditor = editorRef.current;
		if ( ! noteEditor || isEditing ) {
			return;
		}

		if ( noteEditor.innerHTML !== widgetProps.text ) {
			noteEditor.innerHTML = widgetProps.text;
		}
	}, [ isEditing, widgetProps.text ] );

	useEffect( () => {
		if ( ! isEditing ) {
			return;
		}

		const frame = window.requestAnimationFrame( () => {
			const noteEditor = editorRef.current;
			if ( ! noteEditor ) {
				return;
			}

			noteEditor.focus();
			const range = document.createRange();
			range.selectNodeContents( noteEditor );
			range.collapse( false );
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange( range );
		} );

		return () => {
			window.cancelAnimationFrame( frame );
		};
	}, [ isEditing ] );

	const commitText = useCallback( () => {
		const noteEditor = editorRef.current;
		if ( ! noteEditor ) {
			return;
		}

		const value = create( { element: noteEditor } );
		const text = toHTMLString( { value } );
		if ( text === widgetProps.text ) {
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
	}, [ editor, id, shapeType, widgetProps ] );

	const handlePointerDown = useCallback(
		( event: PointerEvent< HTMLDivElement > ) => {
			if ( isEditing ) {
				event.stopPropagation();
			}
		},
		[ isEditing ]
	);

	const handleKeyDown = useCallback(
		( event: KeyboardEvent< HTMLDivElement > ) => {
			event.stopPropagation();

			const isMod = event.metaKey || event.ctrlKey;
			if ( ! isMod ) {
				return;
			}

			if ( event.key === 'b' || event.key === 'i' ) {
				event.preventDefault();
				document.execCommand( event.key === 'b' ? 'bold' : 'italic' );
				commitText();
			} else if ( event.key === 'Enter' ) {
				event.preventDefault();
				commitText();
				editor.complete();
			}
		},
		[ commitText, editor ]
	);

	return (
		<div
			className={ styles.note }
			data-tone={ widgetProps.tone }
			data-is-editing={ isEditing }
			data-studio-desk-widget={ NOTE_WIDGET_TYPE }
		>
			<div
				ref={ editorRef }
				className={ styles.editor }
				contentEditable={ isEditing }
				suppressContentEditableWarning
				spellCheck={ false }
				onInput={ commitText }
				onBlur={ () => {
					commitText();
					editor.complete();
				} }
				onKeyDown={ handleKeyDown }
				onPointerDown={ handlePointerDown }
				data-empty={ ! widgetProps.text ? 'true' : 'false' }
				data-placeholder="Type a note..."
			/>
		</div>
	);
}

function registerCoreFormats() {
	const formats: Array< { name: string; title: string; tagName: string } > = [
		{ name: 'core/bold', title: 'Bold', tagName: 'strong' },
		{ name: 'core/italic', title: 'Italic', tagName: 'em' },
	];

	for ( const format of formats ) {
		try {
			registerFormatType( format.name, {
				name: format.name,
				title: format.title,
				tagName: format.tagName,
				className: null,
				interactive: false,
				object: false,
				edit: () => null,
			} );
		} catch {
			// The rich-text registry is global, so HMR can register these first.
		}
	}
}
