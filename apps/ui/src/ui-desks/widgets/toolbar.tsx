import { decodeEntities } from '@wordpress/html-entities';
import { __, _n, sprintf } from '@wordpress/i18n';
import { arrowUp, comment, group, trash, ungroup } from '@wordpress/icons';
import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { useDeskChats } from '@/ui-desks/chats/context';
import { Divider, IconControlButton, Surface } from '@/ui-desks/components';
import { ControlRenderer } from '@/ui-desks/controls/registry';
import { useDesk } from '@/ui-desks/desk/provider';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import styles from './toolbar.module.css';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import type { DeskWidget, DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type SelectedWidgetToolbarItem = NonNullable< ReturnType< typeof getSelectedWidgetToolbarItem > >;
type WidgetVignetteComponent = ComponentType<
	DeskWidgetComponentProps< Record< string, unknown > >
>;

const MAX_VISIBLE_CHAT_WIDGETS = 3;
const WIDGET_VIGNETTE_MAX_SIZE = 88;
const WIDGET_VIGNETTE_FALLBACK_SIZE = 132;

export function DeskWidgetToolbar() {
	const {
		selectedWidgetToolbarItem,
		stackSelectedWidgets,
		unstackSelectedWidgets,
		updateSelectedWidgetProps,
		removeSelectedWidget,
	} = useDesk();
	const visible = Boolean( selectedWidgetToolbarItem );
	const [ lastSelection, setLastSelection ] = useState< SelectedWidgetToolbarItem | null >( null );
	const [ openControlId, setOpenControlId ] = useState< string | null >( null );
	const [ chatSelectionWidgets, setChatSelectionWidgets ] = useState< DeskWidget[] | null >( null );

	useEffect( () => {
		if ( selectedWidgetToolbarItem ) {
			setLastSelection( selectedWidgetToolbarItem );
		}
	}, [ selectedWidgetToolbarItem ] );

	const renderSelection = visible ? selectedWidgetToolbarItem : lastSelection;
	if ( ! renderSelection ) {
		return null;
	}

	const controls =
		renderSelection.kind === 'single-widget' ? renderSelection.definition.controls : undefined;
	const canRenderControls =
		renderSelection.kind === 'single-widget' &&
		Boolean( controls?.length ) &&
		renderSelection.definition.isWidgetProps( renderSelection.widget.widgetProps );

	return (
		<>
			<Surface
				variant="glass"
				className={ styles.toolbar }
				data-visible={ visible ? 'true' : 'false' }
				role="toolbar"
				aria-label={ __( 'Widget controls' ) }
				aria-hidden={ ! visible }
				onPointerDown={ ( event ) => event.stopPropagation() }
			>
				{ renderSelection.kind === 'multi-widget' && (
					<span className={ styles.label }>
						{ sprintf(
							_n( '%d selected', '%d selected', renderSelection.widgets.length ),
							renderSelection.widgets.length
						) }
					</span>
				) }
				{ canRenderControls &&
					controls?.map( ( control ) => (
						<ControlRenderer
							key={ control.id }
							control={ control }
							isOpen={ openControlId === control.id }
							props={ renderSelection.widget.widgetProps }
							setIsOpen={ ( isOpen ) => setOpenControlId( isOpen ? control.id : null ) }
							updateProps={ updateSelectedWidgetProps }
						/>
					) ) }
				{ ( renderSelection.canStack || renderSelection.canUnstack ) && <Divider /> }
				{ renderSelection.canStack && (
					<IconControlButton
						icon={ group }
						label={ __( 'Stack widgets' ) }
						variant="toolbar"
						onClick={ stackSelectedWidgets }
					/>
				) }
				{ renderSelection.canUnstack && (
					<IconControlButton
						icon={ ungroup }
						label={ __( 'Unstack widgets' ) }
						variant="toolbar"
						onClick={ unstackSelectedWidgets }
					/>
				) }
				<Divider />
				<IconControlButton
					icon={ comment }
					className={ styles.chatToolbarButton }
					label={ __( 'Chat about selection' ) }
					variant="toolbar"
					onClick={ () => setChatSelectionWidgets( renderSelection.widgets ) }
				/>
				{ renderSelection.canRemove && (
					<>
						<Divider />
						<IconControlButton
							icon={ trash }
							label={ __( 'Remove widget selection' ) }
							variant="toolbar"
							onClick={ removeSelectedWidget }
						/>
					</>
				) }
			</Surface>
			{ chatSelectionWidgets && (
				<SelectionChatDialog
					widgets={ chatSelectionWidgets }
					onClose={ () => setChatSelectionWidgets( null ) }
				/>
			) }
		</>
	);
}

function SelectionChatDialog( {
	widgets,
	onClose,
}: {
	widgets: DeskWidget[];
	onClose: () => void;
} ) {
	const { startChatWithPrompt, isCreatingChat } = useDeskChats();
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
		<div
			className={ styles.chatDialogBackdrop }
			onPointerDown={ ( event ) => {
				event.stopPropagation();
				if ( event.target === event.currentTarget ) {
					onClose();
				}
			} }
			onKeyDown={ ( event ) => {
				if ( event.key === 'Escape' ) {
					event.preventDefault();
					onClose();
				}
			} }
		>
			<form
				className={ styles.chatDialog }
				role="dialog"
				aria-modal="true"
				aria-label={ __( 'Chat about selection' ) }
				onSubmit={ ( event ) => {
					event.preventDefault();
					void submitPrompt();
				} }
			>
				<textarea
					ref={ textareaRef }
					className={ styles.chatPromptInput }
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
				<IconControlButton
					icon={ arrowUp }
					iconSize={ 30 }
					className={ styles.chatSendButton }
					label={ isCreatingChat ? __( 'Creating chat' ) : __( 'Send' ) }
					disabled={ ! canSubmit }
					aria-busy={ isCreatingChat }
					variant="toolbar"
					tooltipSide="left"
					onClick={ () => void submitPrompt() }
				/>
				<div className={ styles.chatVignettes } aria-label={ __( 'Selected widgets' ) }>
					{ visibleWidgets.map( ( widget ) => (
						<SelectionWidgetVignette key={ widget.id } widget={ widget } />
					) ) }
					{ hiddenWidgetCount > 0 && <SelectionMoreVignette count={ hiddenWidgetCount } /> }
				</div>
				{ error && <div className={ styles.chatDialogError }>{ error }</div> }
			</form>
		</div>
	);
}

function SelectionWidgetVignette( { widget }: { widget: DeskWidget } ) {
	const definition = getWidgetDefinition( widget.type );
	if ( ! definition || ! definition.isWidgetProps( widget.widgetProps ) ) {
		return null;
	}

	const Thumbnail = ( definition.thumbnail ??
		definition.Component ) as unknown as WidgetVignetteComponent;
	const geometry = getWidgetVignetteGeometry( widget );
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
			className={ styles.chatVignette }
			style={ frameStyle }
			aria-label={ getWidgetDisplayLabel( widget ) }
			title={ getWidgetDisplayLabel( widget ) }
		>
			<div className={ styles.chatVignetteInner } style={ innerStyle }>
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

function SelectionMoreVignette( { count }: { count: number } ) {
	return (
		<div className={ styles.chatMoreVignette } aria-label={ getMoreWidgetsLabel( count ) }>
			{ getMoreWidgetsLabel( count ) }
		</div>
	);
}

function getWidgetVignetteGeometry( widget: DeskWidget ) {
	const sourceWidth = getVignetteSourceSize( widget.shapeProps.w );
	const sourceHeight = getVignetteSourceSize( widget.shapeProps.h );
	const scale = Math.min( 1, WIDGET_VIGNETTE_MAX_SIZE / Math.max( sourceWidth, sourceHeight ) );

	return {
		sourceWidth,
		sourceHeight,
		scale,
		width: sourceWidth * scale,
		height: sourceHeight * scale,
	};
}

function getVignetteSourceSize( value: number ) {
	if ( value < 24 ) {
		return WIDGET_VIGNETTE_FALLBACK_SIZE;
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
		'Use the following Studio Desk canvas selection as context.',
		'The selected items are widgets from the user desk. Refer to widget IDs and WordPress entity IDs when helpful.',
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
