import { __, _n, sprintf } from '@wordpress/i18n';
import { category, connection, group, pencil, trash, ungroup, update } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import { ChatButton } from '@/ui-desks/chats/chat-button';
import { SelectionChatDialog } from '@/ui-desks/chats/selection-chat-dialog';
import { Divider, Button, Surface } from '@/ui-desks/components';
import { appendIncomingConnectedWidgets } from '@/ui-desks/connectors/context';
import { ControlRenderer } from '@/ui-desks/controls/registry';
import { useDesk } from '@/ui-desks/desk/provider';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import styles from './style.module.css';
import type { getSelectedWidgetToolbarItem } from './selection';
import type { DeskWidgetConnectionTarget } from '@/ui-desks/connectors/context';
import type { AnySelectControlConfig } from '@/ui-desks/controls/types';
import type { StackViewMode } from '@/ui-desks/stacks/utils';
import type { DeskWidget } from '@/ui-desks/widgets/types';

type SelectedWidgetToolbarItem = NonNullable< ReturnType< typeof getSelectedWidgetToolbarItem > >;

const STACK_VIEW_MODE_CONTROL: AnySelectControlConfig = {
	type: 'select',
	id: 'stack-view-mode',
	property: 'viewMode',
	label: __( 'Display' ),
	icon: category,
	defaultValue: 'stack',
	options: [
		{ value: 'stack', label: __( 'Stack' ) },
		{ value: 'tiles', label: __( 'Tiles' ) },
	],
};

export function DeskWidgetToolbar() {
	const {
		selectedWidgetToolbarItem,
		fitSelectedWidgetToContent,
		stackSelectedWidgets,
		unstackSelectedWidgets,
		setSelectedStackView,
		runSelectedWidgetAction,
		updateSelectedWidgetProps,
		canEditSelectedWidget,
		editSelectedWidget,
		removeSelectedWidget,
		selectedConnectorToolbarItem,
		selectedWidgetConnectionTargets,
		removeSelectedConnector,
		focusConnectedWidget,
		getDeskConfigSnapshot,
		focusMode,
		focusedWidget,
		focusedWidgetDefinition,
	} = useDesk();
	const visible = Boolean(
		selectedWidgetToolbarItem ||
			selectedConnectorToolbarItem ||
			selectedWidgetConnectionTargets.length > 0
	);
	const [ lastSelection, setLastSelection ] = useState< SelectedWidgetToolbarItem | null >( null );
	const [ lastConnectorSelection, setLastConnectorSelection ] =
		useState< typeof selectedConnectorToolbarItem >( null );
	const [ lastConnectionTargets, setLastConnectionTargets ] = useState<
		typeof selectedWidgetConnectionTargets
	>( [] );
	const [ openControlId, setOpenControlId ] = useState< string | null >( null );
	const [ chatWidgets, setChatWidgets ] = useState< DeskWidget[] | null >( null );
	const focusModeControls =
		focusMode &&
		focusedWidget &&
		focusedWidgetDefinition?.isWidgetProps( focusedWidget.widgetProps )
			? focusedWidgetDefinition.focusModeControls
			: undefined;

	useEffect( () => {
		if ( selectedWidgetToolbarItem ) {
			setLastSelection( selectedWidgetToolbarItem );
		}
		if ( selectedConnectorToolbarItem ) {
			setLastConnectorSelection( selectedConnectorToolbarItem );
		}
		if ( selectedWidgetConnectionTargets.length > 0 ) {
			setLastConnectionTargets( selectedWidgetConnectionTargets );
		}
	}, [ selectedConnectorToolbarItem, selectedWidgetConnectionTargets, selectedWidgetToolbarItem ] );

	if ( focusedWidget && focusModeControls?.length ) {
		return (
			<Surface
				variant="glass"
				className={ styles.toolbar }
				data-visible="true"
				role="toolbar"
				aria-label={ focusedWidgetDefinition?.focusModeControlsLabel?.() ?? __( 'Focus actions' ) }
				onPointerDown={ ( event ) => event.stopPropagation() }
			>
				{ focusModeControls.map( ( control ) => (
					<ControlRenderer
						key={ control.id }
						control={ control }
						isOpen={ openControlId === control.id }
						props={ focusedWidget.widgetProps }
						runWidgetAction={ runSelectedWidgetAction }
						setIsOpen={ ( isOpen ) => setOpenControlId( isOpen ? control.id : null ) }
						updateProps={ updateSelectedWidgetProps }
					/>
				) ) }
			</Surface>
		);
	}

	const renderSelection = visible ? selectedWidgetToolbarItem : lastSelection;
	const renderConnectorSelection = visible ? selectedConnectorToolbarItem : lastConnectorSelection;
	const renderConnectionTargets = visible ? selectedWidgetConnectionTargets : lastConnectionTargets;
	if ( ! renderSelection && ! renderConnectorSelection && renderConnectionTargets.length === 0 ) {
		return null;
	}

	const controls =
		renderSelection?.kind === 'single-widget' ? renderSelection.definition.controls : undefined;
	const canFitSelectedWidgetToContent =
		renderSelection?.kind === 'single-widget' &&
		Boolean( renderSelection.definition.getFittedShapeProps ) &&
		renderSelection.definition.isWidgetProps( renderSelection.widget.widgetProps );
	const canRenderControls =
		renderSelection?.kind === 'single-widget' &&
		Boolean( controls?.length ) &&
		renderSelection.definition.isWidgetProps( renderSelection.widget.widgetProps );
	const canRenderEditControl =
		renderSelection?.kind === 'single-widget' &&
		canEditSelectedWidget &&
		renderSelection.widget.type !== SITE_PREVIEW_WIDGET_TYPE;

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
				{ renderConnectorSelection && (
					<>
						<Button
							icon={ trash }
							label={ __( 'Remove connection' ) }
							variant="quiet"
							size="medium"
							onClick={ removeSelectedConnector }
						/>
					</>
				) }
				{ ! renderConnectorSelection && renderSelection?.kind === 'multi-widget' && (
					<span className={ styles.label }>
						{ sprintf(
							_n( '%d selected', '%d selected', renderSelection.widgets.length ),
							renderSelection.widgets.length
						) }
					</span>
				) }
				{ ! renderConnectorSelection && canRenderEditControl && (
					<Button
						icon={ pencil }
						label={ renderSelection.definition.labels.edit?.() ?? __( 'Edit' ) }
						variant="quiet"
						size="medium"
						onClick={ editSelectedWidget }
					/>
				) }
				{ ! renderConnectorSelection && canFitSelectedWidgetToContent && (
					<Button
						icon={ update }
						label={ __( 'Fit to size' ) }
						variant="quiet"
						size="medium"
						onClick={ () => {
							void fitSelectedWidgetToContent();
						} }
					/>
				) }
				{ ! renderConnectorSelection &&
					canRenderControls &&
					controls?.map( ( control ) => (
						<ControlRenderer
							key={ control.id }
							control={ control }
							isOpen={ openControlId === control.id }
							props={ renderSelection.widget.widgetProps }
							runWidgetAction={ runSelectedWidgetAction }
							setIsOpen={ ( isOpen ) => setOpenControlId( isOpen ? control.id : null ) }
							updateProps={ updateSelectedWidgetProps }
						/>
					) ) }
				{ ! renderConnectorSelection && renderSelection?.canSetStackView && (
					<ControlRenderer
						control={ STACK_VIEW_MODE_CONTROL }
						isOpen={ openControlId === STACK_VIEW_MODE_CONTROL.id }
						props={ { viewMode: renderSelection.stackViewMode ?? 'stack' } }
						runWidgetAction={ runSelectedWidgetAction }
						setIsOpen={ ( isOpen ) =>
							setOpenControlId( isOpen ? STACK_VIEW_MODE_CONTROL.id : null )
						}
						updateProps={ ( nextProps ) => {
							if ( isStackViewMode( nextProps.viewMode ) ) {
								setSelectedStackView( nextProps.viewMode );
							}
						} }
					/>
				) }
				{ ! renderConnectorSelection && renderConnectionTargets.length > 0 && renderSelection && (
					<Divider />
				) }
				{ ! renderConnectorSelection && renderConnectionTargets.length > 0 && (
					<ConnectedToControl
						targets={ renderConnectionTargets }
						onFocusTarget={ focusConnectedWidget }
					/>
				) }
				{ ! renderConnectorSelection &&
					renderSelection &&
					( renderSelection.canStack ||
						renderSelection.canUnstack ||
						renderSelection.canSetStackView ) && <Divider /> }
				{ ! renderConnectorSelection && renderSelection?.canStack && (
					<Button
						icon={ group }
						label={ __( 'Stack widgets' ) }
						variant="quiet"
						size="medium"
						onClick={ stackSelectedWidgets }
					/>
				) }
				{ ! renderConnectorSelection && renderSelection?.canUnstack && (
					<Button
						icon={ ungroup }
						label={ __( 'Unstack widgets' ) }
						variant="quiet"
						size="medium"
						onClick={ unstackSelectedWidgets }
					/>
				) }
				{ ! renderConnectorSelection && renderSelection && <Divider /> }
				{ ! renderConnectorSelection && renderSelection && (
					<ChatButton
						onClick={ () =>
							setChatWidgets(
								appendIncomingConnectedWidgets( renderSelection.widgets, getDeskConfigSnapshot() )
							)
						}
					/>
				) }
				{ ! renderConnectorSelection && renderSelection?.canRemove && (
					<>
						<Divider />
						<Button
							icon={ trash }
							label={ __( 'Remove widget selection' ) }
							variant="quiet"
							size="medium"
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

function ConnectedToControl( {
	targets,
	onFocusTarget,
}: {
	targets: DeskWidgetConnectionTarget[];
	onFocusTarget: ( shapeId: DeskWidgetConnectionTarget[ 'shapeId' ] ) => boolean;
} ) {
	const [ open, setOpen ] = useState( false );

	useEffect( () => {
		if ( targets.length === 0 ) {
			setOpen( false );
		}
	}, [ targets.length ] );

	return (
		<div className={ styles.connectedTo }>
			<Button
				icon={ connection }
				label={ sprintf(
					_n( 'Connected to %d widget', 'Connected to %d widgets', targets.length ),
					targets.length
				) }
				variant="quiet"
				size="medium"
				aria-pressed={ open }
				onClick={ () => setOpen( ( current ) => ! current ) }
			/>
			{ open && (
				<div className={ styles.connectedPanel } role="menu">
					{ targets.map( ( target ) => (
						<button
							key={ target.shapeId }
							type="button"
							className={ styles.connectedItem }
							role="menuitem"
							onClick={ () => {
								onFocusTarget( target.shapeId );
								setOpen( false );
							} }
						>
							<span className={ styles.connectedDot } aria-hidden="true" />
							<span className={ styles.connectedLabel }>{ target.label }</span>
						</button>
					) ) }
				</div>
			) }
		</div>
	);
}

function isStackViewMode( value: unknown ): value is StackViewMode {
	return value === 'stack' || value === 'tiles';
}
