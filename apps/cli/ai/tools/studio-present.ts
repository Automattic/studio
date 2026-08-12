import {
	getStudioPresentationRulesPrompt,
	getStudioWidgetDraftValidationError,
	getStudioWidgetPromptManifest,
} from '@studio/common/ai/studio-widgets';
import { Type } from 'typebox';
import { defineTool } from './define-tool';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';

const MAX_WIDGETS_PER_PRESENTATION = 8;

const description = `Shows a live preview of the current local site in Studio.
Use this after a meaningful user-visible result, such as a created site, useful preview path, or page state worth keeping in view.

Presentation rules:
${ getStudioPresentationRulesPrompt() }

Available artifact types:
${ getStudioWidgetPromptManifest() }`;

export const studioPresentTool = defineTool(
	'studio_present',
	description,
	{
		widgets: Type.Array(
			Type.Object( {
				type: Type.String( {
					description: 'The Studio artifact type to present.',
				} ),
				widgetProps: Type.Record( Type.String(), Type.Unknown(), {
					description: 'Widget-specific props. Use the widget manifest in the tool description.',
				} ),
				shapeProps: Type.Optional(
					Type.Record( Type.String(), Type.Unknown(), {
						description: 'Optional widget dimensions. Only numeric w and h are supported.',
					} )
				),
			} ),
			{
				description: 'One or more live preview artifacts to show in Studio.',
				minItems: 1,
				maxItems: MAX_WIDGETS_PER_PRESENTATION,
			}
		),
		message: Type.Optional(
			Type.String( {
				description: 'Optional concise summary of what is being presented.',
			} )
		),
	},
	async ( args ) => {
		const widgets = validateWidgets( args.widgets );
		return {
			content: [
				{
					type: 'text' as const,
					text:
						args.message?.trim() ||
						`Presented ${ widgets.length } Studio widget${ widgets.length === 1 ? '' : 's' }.`,
				},
			],
			studioArtifacts: widgets,
		};
	}
);

function validateWidgets( widgets: unknown ): StudioChatArtifactWidgetDraft[] {
	if ( ! Array.isArray( widgets ) ) {
		throw new Error( 'widgets must be an array.' );
	}

	if ( widgets.length === 0 ) {
		throw new Error( 'Pass at least one widget to present.' );
	}

	if ( widgets.length > MAX_WIDGETS_PER_PRESENTATION ) {
		throw new Error( `Present at most ${ MAX_WIDGETS_PER_PRESENTATION } widgets at a time.` );
	}

	return widgets.map( ( widget, index ) => {
		const validationError = getStudioWidgetDraftValidationError( widget );
		if ( validationError ) {
			throw new Error( `Invalid widget at index ${ index }: ${ validationError }` );
		}

		const draft = widget as StudioChatArtifactWidgetDraft;
		return {
			type: draft.type,
			widgetProps: { ...draft.widgetProps },
			...( draft.shapeProps ? { shapeProps: { ...draft.shapeProps } } : {} ),
		};
	} );
}
