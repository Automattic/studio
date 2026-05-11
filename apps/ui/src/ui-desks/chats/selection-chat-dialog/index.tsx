import { decodeEntities } from '@wordpress/html-entities';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { useChats } from '@/ui-desks/chats/context';
import {
	PromptDialog,
	PromptDialogError,
	PromptDialogRow,
	PromptDialogSubmit,
	promptDialogInputClassName,
} from '@/ui-desks/components';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import styles from './style.module.css';
import type { DeskWidget, DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type WidgetThumbnailComponent = ComponentType<
	DeskWidgetComponentProps< Record< string, unknown > >
>;

const MAX_VISIBLE_CHAT_WIDGETS = 3;
const WIDGET_THUMBNAIL_MAX_SIZE = 72;
const WIDGET_THUMBNAIL_FALLBACK_SIZE = 96;

interface SelectionChatDialogProps {
	widgets: DeskWidget[];
	onClose: () => void;
}

export function SelectionChatDialog( { widgets, onClose }: SelectionChatDialogProps ) {
	const { startChatWithPrompt, isCreatingChat } = useChats();
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const [ prompt, setPrompt ] = useState( '' );
	const [ error, setError ] = useState< string | null >( null );
	const canSubmit = prompt.trim().length > 0 && ! isCreatingChat;
	const visibleWidgets = widgets.slice( 0, MAX_VISIBLE_CHAT_WIDGETS );
	const hiddenWidgetCount = widgets.length - visibleWidgets.length;

	useEffect( () => {
		textareaRef.current?.focus();
	}, [] );

	const submitPrompt = async () => {
		const userPrompt = prompt.trim();
		if ( ! userPrompt || isCreatingChat ) {
			return;
		}

		setError( null );
		try {
			await startChatWithPrompt( {
				prompt: buildSelectionPrompt( userPrompt, widgets ),
				displayMessage: buildSelectionDisplayMessage( userPrompt, widgets ),
			} );
			onClose();
		} catch ( submitError ) {
			setError(
				submitError instanceof Error ? submitError.message : __( 'Unable to start chat.' )
			);
		}
	};

	return (
		<PromptDialog
			ariaLabel={ __( 'Chat about selection' ) }
			onClose={ onClose }
			onSubmit={ ( event ) => {
				event.preventDefault();
				void submitPrompt();
			} }
		>
			<PromptDialogRow>
				<textarea
					ref={ textareaRef }
					className={ promptDialogInputClassName }
					value={ prompt }
					rows={ 1 }
					placeholder={ __( 'Ask about this selection...' ) }
					onChange={ ( event ) => setPrompt( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
							event.preventDefault();
							void submitPrompt();
						}
					} }
				/>
				<PromptDialogSubmit
					label={ isCreatingChat ? __( 'Creating chat' ) : __( 'Send' ) }
					disabled={ ! canSubmit }
					aria-busy={ isCreatingChat }
					onClick={ () => void submitPrompt() }
				/>
			</PromptDialogRow>
			<div className={ styles.thumbnails } aria-label={ __( 'Selected widgets' ) }>
				{ visibleWidgets.map( ( widget ) => (
					<SelectionWidgetThumbnail key={ widget.id } widget={ widget } />
				) ) }
				{ hiddenWidgetCount > 0 && <SelectionMoreThumbnail count={ hiddenWidgetCount } /> }
			</div>
			{ error && <PromptDialogError>{ error }</PromptDialogError> }
		</PromptDialog>
	);
}

function SelectionWidgetThumbnail( { widget }: { widget: DeskWidget } ) {
	const definition = getWidgetDefinition( widget.type );
	if ( ! definition || ! definition.isWidgetProps( widget.widgetProps ) ) {
		return null;
	}

	const Thumbnail = ( definition.thumbnail ??
		definition.Component ) as unknown as WidgetThumbnailComponent;
	const geometry = getWidgetThumbnailGeometry( widget );
	const frameStyle = {
		width: `${ geometry.width }px`,
		height: `${ geometry.height }px`,
	} satisfies CSSProperties;
	const innerStyle = {
		width: `${ geometry.sourceWidth }px`,
		height: `${ geometry.sourceHeight }px`,
		transform: `scale(${ geometry.scale })`,
	} satisfies CSSProperties;

	return (
		<div
			className={ styles.thumbnail }
			style={ frameStyle }
			aria-label={ getWidgetDisplayLabel( widget ) }
			title={ getWidgetDisplayLabel( widget ) }
		>
			<div className={ styles.thumbnailInner } style={ innerStyle }>
				<Thumbnail
					id={ widget.id }
					widgetProps={ widget.widgetProps }
					isEditing={ false }
					isHovered={ false }
					isSelected={ false }
					onWidgetPropsChange={ noopWidgetPropsChange }
					onEditComplete={ noopWidgetEditComplete }
				/>
			</div>
		</div>
	);
}

function SelectionMoreThumbnail( { count }: { count: number } ) {
	return (
		<div className={ styles.moreThumbnail } aria-label={ getMoreWidgetsLabel( count ) }>
			{ getMoreWidgetsLabel( count ) }
		</div>
	);
}

function getWidgetThumbnailGeometry( widget: DeskWidget ) {
	const sourceWidth = getThumbnailSourceSize( widget.shapeProps.w );
	const sourceHeight = getThumbnailSourceSize( widget.shapeProps.h );
	const scale = Math.min( 1, WIDGET_THUMBNAIL_MAX_SIZE / Math.max( sourceWidth, sourceHeight ) );

	return {
		sourceWidth,
		sourceHeight,
		scale,
		width: sourceWidth * scale,
		height: sourceHeight * scale,
	};
}

function getThumbnailSourceSize( value: number ) {
	if ( value < 24 ) {
		return WIDGET_THUMBNAIL_FALLBACK_SIZE;
	}

	return value;
}

function getMoreWidgetsLabel( count: number ) {
	return sprintf(
		/* translators: %d: number of additional selected widgets. */
		__( '+%d more' ),
		count
	);
}

function buildSelectionPrompt( userPrompt: string, widgets: DeskWidget[] ) {
	const context = widgets
		.map( ( widget, index ) => `${ index + 1 }. ${ getWidgetPromptContext( widget ) }` )
		.join( '\n' );

	return [
		'Use the following Studio canvas selection as context.',
		'The selected items are canvas widgets. Refer to widget IDs and WordPress entity IDs when helpful.',
		'',
		context,
		'',
		'User request:',
		userPrompt,
	].join( '\n' );
}

function buildSelectionDisplayMessage( userPrompt: string, widgets: DeskWidget[] ) {
	return sprintf(
		/* translators: 1: user prompt, 2: short selected widget summary. */
		__( '%1$s\n\nSelected context: %2$s' ),
		userPrompt,
		summarizeWidgetList( widgets )
	);
}

function summarizeWidgetList( widgets: DeskWidget[] ) {
	const visibleWidgets = widgets.slice( 0, 3 );
	const labels = visibleWidgets.map( getWidgetDisplayLabel );
	const hiddenCount = widgets.length - visibleWidgets.length;
	if ( hiddenCount <= 0 ) {
		return labels.join( ', ' );
	}

	return sprintf(
		/* translators: 1: comma-separated selected widget labels, 2: number of additional widgets. */
		_n( '%1$s + %2$d more', '%1$s + %2$d more', hiddenCount ),
		labels.join( ', ' ),
		hiddenCount
	);
}

function getWidgetTypeLabel( widget: DeskWidget ) {
	switch ( widget.type ) {
		case 'bookmark':
			return __( 'Link' );
		case 'blog':
			return __( 'Blog' );
		case 'embed':
			return __( 'Embed' );
		case 'note':
			return __( 'Note' );
		case 'post':
			return __( 'Post' );
		case 'page':
			return __( 'Page' );
		case 'post-collection':
			return __( 'Posts' );
		case 'site-preview':
			return __( 'Preview' );
	}
}

function getWidgetDisplayLabel( widget: DeskWidget ) {
	const summary = getWidgetSummary( widget );
	return summary ? `${ getWidgetTypeLabel( widget ) }: ${ summary }` : getWidgetTypeLabel( widget );
}

function getWidgetSummary( widget: DeskWidget ) {
	switch ( widget.type ) {
		case 'bookmark':
			return widget.widgetProps.url;
		case 'embed':
			return widget.widgetProps.url;
		case 'blog':
			return widget.widgetProps.slug
				? `${ widget.widgetProps.title } /${ widget.widgetProps.slug }`
				: widget.widgetProps.title;
		case 'note':
			return truncateText( stripMarkup( widget.widgetProps.text ), 72 ) || __( 'Empty note' );
		case 'post':
			return sprintf(
				/* translators: %d: WordPress post ID. */
				__( 'Post #%d' ),
				widget.widgetProps.postId
			);
		case 'page':
			return sprintf(
				/* translators: %d: WordPress page ID. */
				__( 'Page #%d' ),
				widget.widgetProps.pageId
			);
		case 'post-collection':
			return sprintf(
				/* translators: 1: number of posts, 2: post status. */
				__( '%1$d %2$s posts' ),
				widget.widgetProps.query.perPage,
				widget.widgetProps.query.status
			);
		case 'site-preview':
			return widget.widgetProps.path || '/';
	}
}

function getWidgetPromptContext( widget: DeskWidget ) {
	switch ( widget.type ) {
		case 'bookmark':
			return formatPromptContext( widget, {
				url: widget.widgetProps.url,
			} );
		case 'embed':
			return formatPromptContext( widget, {
				url: widget.widgetProps.url,
			} );
		case 'blog':
			return formatPromptContext( widget, {
				title: widget.widgetProps.title,
				slug: widget.widgetProps.slug,
			} );
		case 'note':
			return formatPromptContext( widget, {
				text: stripMarkup( widget.widgetProps.text ),
				tone: widget.widgetProps.tone,
			} );
		case 'post':
			return formatPromptContext( widget, {
				postId: widget.widgetProps.postId,
			} );
		case 'page':
			return formatPromptContext( widget, {
				pageId: widget.widgetProps.pageId,
				tone: widget.widgetProps.tone,
			} );
		case 'post-collection':
			return formatPromptContext( widget, {
				query: widget.widgetProps.query,
			} );
		case 'site-preview':
			return formatPromptContext( widget, {
				path: widget.widgetProps.path,
			} );
	}
}

function formatPromptContext( widget: DeskWidget, details: Record< string, unknown > ) {
	return JSON.stringify( {
		widgetId: widget.id,
		type: widget.type,
		position: {
			x: widget.x,
			y: widget.y,
		},
		...details,
	} );
}

function stripMarkup( value: string ) {
	return decodeEntities(
		value
			.replace( /<[^>]*>/g, ' ' )
			.replace( /\s+/g, ' ' )
			.trim()
	);
}

function truncateText( value: string, maxLength: number ) {
	if ( value.length <= maxLength ) {
		return value;
	}

	return `${ value.slice( 0, maxLength - 3 ).trimEnd() }...`;
}

function noopWidgetPropsChange() {}
function noopWidgetEditComplete() {}
