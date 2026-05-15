import { __ } from '@wordpress/i18n';
import { blockDefault, page, reusableBlock } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { SCRATCHPAD_WIDGET_TYPE, type ScratchpadScope, type ScratchpadWidgetProps } from '../types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type ScratchpadWidgetComponentProps = DeskWidgetComponentProps< ScratchpadWidgetProps >;

export function ScratchpadWidgetComponent( {
	id,
	widgetProps,
	isEditing,
	isHovered,
	isSelected,
	onWidgetPropsChange,
	onEditComplete,
}: ScratchpadWidgetComponentProps ) {
	const descriptionRef = useRef< HTMLDivElement | null >( null );
	const labelVisible = isHovered || isSelected || isEditing;
	const isInteractive = isEditing;
	const description = widgetProps.description ?? '';

	useEffect( () => {
		const descriptionElement = descriptionRef.current;
		if ( ! descriptionElement || document.activeElement === descriptionElement ) {
			return;
		}

		if ( descriptionElement.textContent !== description ) {
			descriptionElement.textContent = description;
		}
	}, [ description ] );

	useEffect( () => {
		if ( ! isEditing ) {
			return;
		}

		const frame = window.requestAnimationFrame( () => {
			const description = descriptionRef.current;
			if ( ! description ) {
				return;
			}

			description.focus();
			const range = document.createRange();
			range.selectNodeContents( description );
			range.collapse( false );
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange( range );
		} );

		return () => {
			window.cancelAnimationFrame( frame );
		};
	}, [ isEditing ] );

	const updateDescription = useCallback( () => {
		onWidgetPropsChange( {
			...widgetProps,
			description: descriptionRef.current?.textContent ?? '',
		} );
	}, [ onWidgetPropsChange, widgetProps ] );

	const handleDescriptionPointerDown = useCallback(
		( event: PointerEvent< HTMLDivElement > ) => {
			if ( isEditing ) {
				event.stopPropagation();
			}
		},
		[ isEditing ]
	);

	const handleDescriptionKeyDown = useCallback(
		( event: KeyboardEvent< HTMLDivElement > ) => {
			event.stopPropagation();
			if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
				event.preventDefault();
				onEditComplete();
			}
		},
		[ onEditComplete ]
	);

	return (
		<div
			className={ styles.scratchpad }
			data-scope={ widgetProps.scope }
			data-is-editing={ isEditing ? 'true' : 'false' }
			data-studio-desk-widget={ SCRATCHPAD_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ widgetProps.title && (
				<div
					className={ styles.title }
					data-visible={ labelVisible ? 'true' : 'false' }
					title={ widgetProps.title }
				>
					{ widgetProps.title }
				</div>
			) }
			{ widgetProps.html ? (
				<iframe
					className={ styles.frame }
					title={ widgetProps.title || __( 'Scratchpad' ) }
					srcDoc={ widgetProps.html }
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
					draggable={ false }
					tabIndex={ isInteractive ? 0 : -1 }
					style={ {
						pointerEvents: isInteractive ? 'auto' : 'none',
					} }
				/>
			) : (
				<div className={ styles.empty }>{ __( 'Empty scratchpad' ) }</div>
			) }
			<div className={ styles.bottom }>
				<div
					ref={ descriptionRef }
					className={ styles.description }
					contentEditable={ isEditing }
					suppressContentEditableWarning
					spellCheck={ false }
					data-empty={ description ? 'false' : 'true' }
					data-placeholder={ __( 'Describe what this scratchpad should become...' ) }
					onBlur={ () => {
						updateDescription();
						onEditComplete();
					} }
					onInput={ updateDescription }
					onKeyDown={ handleDescriptionKeyDown }
					onPointerDown={ handleDescriptionPointerDown }
				/>
			</div>
			{ ! isInteractive && <div className={ styles.shield } aria-hidden="true" /> }
		</div>
	);
}

export function ScratchpadWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< ScratchpadWidgetProps > ) {
	return (
		<div
			className={ styles.thumbnail }
			data-studio-desk-widget={ SCRATCHPAD_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<Icon icon={ getScratchpadScopeIcon( widgetProps.scope ) } size={ 24 } />
			<div className={ styles.thumbnailTitle }>{ widgetProps.title || __( 'Scratchpad' ) }</div>
		</div>
	);
}

function getScratchpadScopeIcon( scope: ScratchpadScope ) {
	switch ( scope ) {
		case 'page':
			return page;
		case 'pattern':
			return reusableBlock;
		case 'block':
			return blockDefault;
	}
}
