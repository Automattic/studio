import { __, _n, sprintf } from '@wordpress/i18n';
import { category, connection, group, pencil, trash, ungroup, update } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import {
	formatAnnotationsAsPrompt,
	formatAnnotationsSubmittedMessage,
} from '@/components/site-preview/annotations';
import { ChatButton } from '@/ui-desks/chats/chat-button';
import { useChats } from '@/ui-desks/chats/context';
import { SelectionChatDialog } from '@/ui-desks/chats/selection-chat-dialog';
import { Divider, Button, Surface } from '@/ui-desks/components';
import { ControlRenderer } from '@/ui-desks/controls/registry';
import { useDesk } from '@/ui-desks/desk/provider';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import styles from './style.module.css';
import type { getSelectedWidgetToolbarItem } from './selection';
import type { DeskWidgetConnectionTarget } from '@/ui-desks/connectors/utils';
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
		updateSelectedWidgetProps,
		canEditSelectedWidget,
		editSelectedWidget,
		removeSelectedWidget,
		selectedConnectorToolbarItem,
		selectedWidgetConnectionTargets,
		removeSelectedConnector,
		focusConnectedWidget,
		annotatingPreviewShapeId,
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

	if ( annotatingPreviewShapeId ) {
		return <AnnotateToolbar />;
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
							setIsOpen={ ( isOpen ) => setOpenControlId( isOpen ? control.id : null ) }
							updateProps={ updateSelectedWidgetProps }
						/>
					) ) }
				{ ! renderConnectorSelection && renderSelection?.canSetStackView && (
					<ControlRenderer
						control={ STACK_VIEW_MODE_CONTROL }
						isOpen={ openControlId === STACK_VIEW_MODE_CONTROL.id }
						props={ { viewMode: renderSelection.stackViewMode ?? 'stack' } }
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
					<ChatButton onClick={ () => setChatWidgets( renderSelection.widgets ) } />
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

function AnnotateToolbar() {
	const {
		annotationCount,
		selectedAnnotationNoteShapeId,
		stopAnnotatingPreview,
		removeSelectedAnnotation,
		collectAnnotationSubmission,
	} = useDesk();
	const { startChatWithPrompt, isCreatingChat } = useChats();
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const isBusy = isCreatingChat || isSubmitting;

	const cancel = () => {
		if ( annotationCount > 0 ) {
			const shouldDiscard = window.confirm(
				sprintf(
					_n( 'Discard %d annotation?', 'Discard %d annotations?', annotationCount ),
					annotationCount
				)
			);
			if ( ! shouldDiscard ) {
				return;
			}
		}
		stopAnnotatingPreview();
	};

	const submit = async () => {
		if ( annotationCount === 0 || isBusy ) {
			return;
		}
		const submission = collectAnnotationSubmission();
		if ( ! submission ) {
			return;
		}

		setIsSubmitting( true );
		try {
			const annotationPrompt = formatAnnotationsAsPrompt( submission.annotations );
			await startChatWithPrompt( {
				prompt: submission.previewWidget
					? buildAnnotationWidgetContextPrompt( annotationPrompt, [ submission.previewWidget ] )
					: annotationPrompt,
				displayMessage: formatAnnotationsSubmittedMessage( submission.annotations.length ),
			} );
			stopAnnotatingPreview();
		} catch ( error ) {
			console.warn( 'Unable to submit annotations.', error );
		} finally {
			setIsSubmitting( false );
		}
	};

	return (
		<Surface
			variant="glass"
			className={ styles.toolbar }
			data-visible="true"
			role="toolbar"
			aria-label={ __( 'Annotate actions' ) }
			onPointerDown={ ( event ) => event.stopPropagation() }
		>
			<Button
				label={ __( 'Cancel' ) }
				variant="quiet"
				size="medium"
				tooltipLabel={ false }
				onClick={ cancel }
			>
				{ __( 'Cancel' ) }
			</Button>
			{ annotationCount > 0 && (
				<>
					<Divider />
					<Button
						label={ sprintf(
							_n( 'Submit %d change', 'Submit %d changes', annotationCount ),
							annotationCount
						) }
						variant="filled"
						tone="primary"
						size="medium"
						tooltipLabel={ false }
						disabled={ isBusy }
						onClick={ () => void submit() }
					>
						{ sprintf(
							_n( 'Submit %d change', 'Submit %d changes', annotationCount ),
							annotationCount
						) }
					</Button>
				</>
			) }
			{ selectedAnnotationNoteShapeId && (
				<>
					<Divider />
					<Button
						icon={ trash }
						label={ __( 'Remove annotation' ) }
						variant="quiet"
						size="medium"
						onClick={ removeSelectedAnnotation }
					/>
				</>
			) }
		</Surface>
	);
}

function buildAnnotationWidgetContextPrompt( userPrompt: string, widgets: DeskWidget[] ) {
	const context = widgets
		.map(
			( widget, index ) =>
				`${ index + 1 }. ${ JSON.stringify( {
					widgetId: widget.id,
					type: widget.type,
					position: {
						x: widget.x,
						y: widget.y,
					},
					widgetProps: widget.widgetProps,
				} ) }`
		)
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
