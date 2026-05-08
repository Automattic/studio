import {
	__unstableUseRichText as useRichText,
	registerFormatType,
	toggleFormat,
	type RichTextValue,
} from '@wordpress/rich-text';
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditor, useIsEditing, type TLUnknownShape } from 'tldraw';
import { NOTE_WIDGET_TYPE, type NoteWidgetProps } from '@/ui-desks/widgets/note/types';
import styles from './style.module.css';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type NoteWidgetComponentProps = DeskWidgetComponentProps< NoteWidgetProps >;

const NOTE_TEXT_FORMATS = [
	{ name: 'core/bold', title: 'Bold', tagName: 'strong', shortcut: 'b' },
	{ name: 'core/italic', title: 'Italic', tagName: 'em', shortcut: 'i' },
] as const;

type NoteTextFormatName = ( typeof NOTE_TEXT_FORMATS )[ number ][ 'name' ];

const NOTE_FORMAT_BY_SHORTCUT = Object.fromEntries(
	NOTE_TEXT_FORMATS.map( ( format ) => [ format.shortcut, format.name ] )
) as Record< string, NoteTextFormatName >;

registerNoteFormats();

export function NoteWidgetComponent( { id, shapeType, widgetProps }: NoteWidgetComponentProps ) {
	const editor = useEditor();
	const isEditing = useIsEditing( id );
	const editorRef = useRef< HTMLDivElement | null >( null );

	const updateText = useCallback(
		( text: string ) => {
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

	const richText = useRichText( {
		value: widgetProps.text,
		placeholder: 'Type a note...',
		onChange: updateText,
		onSelectionChange: () => undefined,
		__unstableIsSelected: isEditing,
	} );
	const { ref: richTextRef, getValue: getRichTextValue, onChange: setRichTextValue } = richText;

	const setEditorRef = useCallback(
		( node: HTMLDivElement | null ) => {
			editorRef.current = node;
			richTextRef( node ?? undefined );
		},
		[ richTextRef ]
	);

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

	const handlePointerDown = useCallback(
		( event: PointerEvent< HTMLDivElement > ) => {
			if ( isEditing ) {
				event.stopPropagation();
			}
		},
		[ isEditing ]
	);

	const toggleTextFormat = useCallback(
		( format: NoteTextFormatName ) => {
			const value = getRichTextValue() as RichTextValue | undefined;
			if ( ! value ) {
				return;
			}

			setRichTextValue( toggleFormat( value, { type: format } ) );
		},
		[ getRichTextValue, setRichTextValue ]
	);

	const handleKeyDown = useCallback(
		( event: KeyboardEvent< HTMLDivElement > ) => {
			event.stopPropagation();

			const isMod = event.metaKey || event.ctrlKey;
			if ( ! isMod ) {
				return;
			}

			const format = NOTE_FORMAT_BY_SHORTCUT[ event.key.toLowerCase() ];
			if ( format ) {
				event.preventDefault();
				toggleTextFormat( format );
				return;
			}

			if ( event.key === 'Enter' ) {
				event.preventDefault();
				editor.complete();
			}
		},
		[ editor, toggleTextFormat ]
	);

	return (
		<div
			className={ styles.note }
			data-tone={ widgetProps.tone }
			data-is-editing={ isEditing }
			data-studio-desk-widget={ NOTE_WIDGET_TYPE }
		>
			<div
				ref={ setEditorRef }
				className={ styles.editor }
				contentEditable={ isEditing }
				suppressContentEditableWarning
				spellCheck={ false }
				onBlur={ () => editor.complete() }
				onKeyDown={ handleKeyDown }
				onPointerDown={ handlePointerDown }
			/>
		</div>
	);
}

function registerNoteFormats() {
	const globalObject = globalThis as typeof globalThis & {
		__studioNoteFormatsRegistered?: boolean;
	};

	if ( globalObject.__studioNoteFormatsRegistered ) {
		return;
	}

	for ( const { name, title, tagName } of NOTE_TEXT_FORMATS ) {
		registerFormatType( name, {
			name,
			title,
			tagName,
			interactive: false,
			object: false,
			className: null,
			edit: () => null,
		} );
	}

	globalObject.__studioNoteFormatsRegistered = true;
}
