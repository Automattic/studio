import { __, _n, sprintf } from '@wordpress/i18n';
import { group, trash, ungroup, update } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import { ChatButton } from '@/ui-desks/chats/chat-button';
import { SelectionChatDialog } from '@/ui-desks/chats/selection-chat-dialog';
import { Divider, IconControlButton, Surface } from '@/ui-desks/components';
import { ControlRenderer } from '@/ui-desks/controls/registry';
import { useDesk } from '@/ui-desks/desk/provider';
import styles from './toolbar.module.css';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import type { DeskWidget } from '@/ui-desks/widgets/types';

type SelectedWidgetToolbarItem = NonNullable< ReturnType< typeof getSelectedWidgetToolbarItem > >;

export function DeskWidgetToolbar() {
	const {
		selectedWidgetToolbarItem,
		fitSelectedWidgetToContent,
		stackSelectedWidgets,
		unstackSelectedWidgets,
		updateSelectedWidgetProps,
		removeSelectedWidget,
	} = useDesk();
	const visible = Boolean( selectedWidgetToolbarItem );
	const [ lastSelection, setLastSelection ] = useState< SelectedWidgetToolbarItem | null >( null );
	const [ openControlId, setOpenControlId ] = useState< string | null >( null );
	const [ chatWidgets, setChatWidgets ] = useState< DeskWidget[] | null >( null );

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
	const canFitSelectedWidgetToContent =
		renderSelection.kind === 'single-widget' &&
		Boolean( renderSelection.definition.getFittedShapeProps ) &&
		renderSelection.definition.isWidgetProps( renderSelection.widget.widgetProps );
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
				{ canFitSelectedWidgetToContent && (
					<IconControlButton
						icon={ update }
						label={ __( 'Fit to size' ) }
						variant="toolbar"
						onClick={ () => {
							void fitSelectedWidgetToContent();
						} }
					/>
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
				<ChatButton onClick={ () => setChatWidgets( renderSelection.widgets ) } />
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
			{ chatWidgets && (
				<SelectionChatDialog widgets={ chatWidgets } onClose={ () => setChatWidgets( null ) } />
			) }
		</>
	);
}
