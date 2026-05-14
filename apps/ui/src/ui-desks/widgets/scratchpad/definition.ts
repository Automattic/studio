import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import {
	ScratchpadWidgetComponent,
	ScratchpadWidgetThumbnailComponent,
} from '@/ui-desks/widgets/scratchpad/component';
import {
	SCRATCHPAD_DEFAULT_SHAPE_PROPS,
	getFittedScratchpadShapeProps,
} from '@/ui-desks/widgets/scratchpad/sizing';
import {
	SCRATCHPAD_WIDGET_TYPE,
	isScratchpadWidgetProps,
	type ScratchpadWidget,
} from '@/ui-desks/widgets/scratchpad/types';
import type {
	WidgetCustomDropActionContext,
	WidgetCustomDropActionIntent,
	WidgetDefinition,
} from '@/ui-desks/widgets/types';
import type { Editor, JsonObject } from 'tldraw';

const BUILD_SOMETHING_LIKE_THIS_PROMPT = __( 'Build something like this' );

export const scratchpadWidgetDefinition = {
	type: SCRATCHPAD_WIDGET_TYPE,
	name: () => __( 'Scratchpad' ),
	Component: ScratchpadWidgetComponent,
	thumbnail: ScratchpadWidgetThumbnailComponent,
	isCreatable: true,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isScratchpadWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#14171a',
	} ),
	labels: {
		add: () => __( 'New scratchpad' ),
	},
	icon: external,
	getInitialWidget: () => ( {
		shapeProps: { ...SCRATCHPAD_DEFAULT_SHAPE_PROPS },
		widgetProps: {
			html: '',
			title: '',
			scope: 'block',
			description: '',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.title || __( 'Untitled scratchpad' ),
	getEditAction: () => ( { kind: 'canvas-editing' } ),
	getFittedShapeProps: getFittedScratchpadShapeProps,
	dropHandlers: [
		{
			id: 'media-actions-for-scratchpad',
			type: 'custom',
			sourceTypes: [ MEDIA_WIDGET_TYPE ],
			canHandle: ( sourceWidget ) => isMediaWidgetProps( sourceWidget.widgetProps ),
			getActions: getScratchpadMediaDropActions,
		},
	],
} satisfies WidgetDefinition< ScratchpadWidget >;

function getScratchpadMediaDropActions(
	intent: WidgetCustomDropActionIntent,
	context: WidgetCustomDropActionContext
) {
	if (
		! isMediaWidgetProps( intent.sourceWidget.widgetProps ) ||
		! isScratchpadWidgetProps( intent.targetWidget.widgetProps )
	) {
		return [];
	}

	return [
		{
			label: BUILD_SOMETHING_LIKE_THIS_PROMPT,
			onClick: () =>
				context.runAction( async () => {
					const { buildWidgetContextDisplayMessage, buildWidgetContextPrompt } = await import(
						'@/ui-desks/chats/widget-context'
					);
					updateScratchpadReference( context.editor, intent );
					await context.startChatWithPrompt( {
						prompt: buildWidgetContextPrompt( BUILD_SOMETHING_LIKE_THIS_PROMPT, [
							intent.sourceWidget,
							intent.targetWidget,
						] ),
						displayMessage: buildWidgetContextDisplayMessage( BUILD_SOMETHING_LIKE_THIS_PROMPT, [
							intent.sourceWidget,
							intent.targetWidget,
						] ),
					} );
				} ),
		},
		{
			label: __( 'Use this image' ),
			onClick: () =>
				context.runAction( async () => createConnectorBetweenWidgets( context.editor, intent ) ),
		},
	];
}

function updateScratchpadReference( editor: Editor, intent: WidgetCustomDropActionIntent ) {
	const mediaProps = intent.sourceWidget.widgetProps;
	const targetShape = editor.getShape( intent.targetShapeId ) as RectangleWidgetShape | undefined;
	if (
		! isMediaWidgetProps( mediaProps ) ||
		! targetShape ||
		targetShape.type !== RECTANGLE_WIDGET_SHAPE_TYPE ||
		! isScratchpadWidgetProps( targetShape.props.widgetProps )
	) {
		return;
	}

	const currentDescription = targetShape.props.widgetProps.description ?? '';
	editor.updateShape< RectangleWidgetShape >( {
		id: targetShape.id,
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		props: {
			widgetProps: {
				...targetShape.props.widgetProps,
				description: currentDescription.trim()
					? currentDescription
					: BUILD_SOMETHING_LIKE_THIS_PROMPT,
				reference: {
					mediaId: mediaProps.mediaId,
					url: mediaProps.url,
					alt: mediaProps.alt,
				},
			} satisfies JsonObject,
		},
	} );
}

async function createConnectorBetweenWidgets(
	editor: Editor,
	intent: WidgetCustomDropActionIntent
) {
	const { completeConnectorPreview, createConnectorPreview, toPlainPoint, updateConnectorEnd } =
		await import( '@/ui-desks/connectors/editor-commands' );
	const sourceBounds = editor.getShapePageBounds( intent.sourceShapeId );
	const targetBounds = editor.getShapePageBounds( intent.targetShapeId );
	if ( ! sourceBounds || ! targetBounds ) {
		return;
	}

	const connectorShapeId = createConnectorPreview(
		editor,
		intent.sourceShapeId,
		toPlainPoint( sourceBounds.center ),
		toPlainPoint( targetBounds.center )
	);
	completeConnectorPreview( editor, connectorShapeId, intent.targetShapeId );
	updateConnectorEnd( editor, connectorShapeId, toPlainPoint( targetBounds.center ) );
}
