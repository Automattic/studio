import { select, type AnyConfig, type StoreDescriptor } from '@wordpress/data';
import {
	__unstableUseRichText as useRichText,
	registerFormatType,
	store as richTextStore,
	toggleFormat,
	type RichTextValue,
} from '@wordpress/rich-text';
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditor } from 'tldraw';
import { focusOnDeskShape, useIncomingWidgetConnections } from '@/ui-desks/connectors/utils';
import { getNoteTextSize } from '@/ui-desks/widgets/note/text-sizing';
import { NOTE_WIDGET_TYPE, type NoteWidgetProps } from '@/ui-desks/widgets/note/types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type NoteWidgetComponentProps = DeskWidgetComponentProps< NoteWidgetProps >;

type RichTextFormatSelectors = {
	getFormatType: ( name: string ) => unknown;
};

const NOTE_TEXT_FORMATS = [
	{ name: 'core/bold', title: 'Bold', tagName: 'strong', shortcut: 'b' },
	{ name: 'core/italic', title: 'Italic', tagName: 'em', shortcut: 'i' },
] as const;

type NoteTextFormatName = ( typeof NOTE_TEXT_FORMATS )[ number ][ 'name' ];

const NOTE_FORMAT_BY_SHORTCUT = Object.fromEntries(
	NOTE_TEXT_FORMATS.map( ( format ) => [ format.shortcut, format.name ] )
) as Record< string, NoteTextFormatName >;

registerNoteFormats();

export function NoteWidgetComponent( {
	id,
	shapeId,
	widgetProps,
	isEditing,
	onWidgetPropsChange,
	onEditComplete,
}: NoteWidgetComponentProps ) {
	const editor = useEditor();
	const editorRef = useRef< HTMLDivElement | null >( null );
	const annotation = widgetProps.annotation;
	const connectionSources = useIncomingWidgetConnections( editor, shapeId );
	const hasConnections = connectionSources.length > 0;

	const updateText = useCallback(
		( text: string ) => {
			onWidgetPropsChange( {
				...widgetProps,
				text,
			} );
		},
		[ onWidgetPropsChange, widgetProps ]
	);

	const richText = useRichText( {
		value: widgetProps.text,
		placeholder: annotation ? 'Add a comment...' : 'Type a note...',
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
				onEditComplete();
			}
		},
		[ onEditComplete, toggleTextFormat ]
	);

	return (
		<div
			className={ styles.note }
			data-tone={ widgetProps.tone }
			data-is-editing={ isEditing }
			data-has-annotation={ annotation ? 'true' : 'false' }
			data-has-connections={ hasConnections ? 'true' : 'false' }
			data-text-size={ getNoteTextSize( widgetProps ) }
			data-studio-desk-widget={ NOTE_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ annotation && (
				<div className={ styles.annotationHeader } title={ annotation.selector }>
					{ 'On ' }
					<code>{ annotation.displayName || annotation.selector }</code>
					{ annotation.pathname && (
						<>
							{ ' from ' }
							<code>{ annotation.pathname }</code>
						</>
					) }
				</div>
			) }
			<div
				ref={ setEditorRef }
				className={ styles.editor }
				contentEditable={ isEditing }
				suppressContentEditableWarning
				spellCheck={ false }
				onBlur={ onEditComplete }
				onKeyDown={ handleKeyDown }
				onPointerDown={ handlePointerDown }
			/>
			{ hasConnections && ! annotation && (
				<div className={ styles.using } aria-label="Connected sources">
					<span>Using</span>
					{ connectionSources.map( ( source ) => (
						<button
							key={ source.shapeId }
							type="button"
							className={ styles.usingPill }
							title={ source.title }
							onClick={ () => focusOnDeskShape( editor, source.shapeId ) }
							onPointerDown={ ( event ) => event.stopPropagation() }
						>
							{ source.label }
						</button>
					) ) }
					<span className={ styles.usingPeriod } aria-hidden="true">
						.
					</span>
				</div>
			) }
		</div>
	);
}

export function NoteWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< NoteWidgetProps > ) {
	return (
		<div
			className={ styles.contextThumbnail }
			data-tone={ widgetProps.tone }
			data-studio-desk-widget={ NOTE_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<div
				className={ styles.contextThumbnailText }
				dangerouslySetInnerHTML={ { __html: widgetProps.text } }
			/>
		</div>
	);
}

function registerNoteFormats() {
	const { getFormatType } = select(
		richTextStore as StoreDescriptor< AnyConfig >
	) as unknown as RichTextFormatSelectors;

	for ( const { name, title, tagName } of NOTE_TEXT_FORMATS ) {
		if ( getFormatType( name ) ) {
			continue;
		}

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
}
