import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	DESIGN_SYSTEM_PREVIEW_PATH,
	STUDIO_CHAT_ARTIFACT_VERSION,
	type StudioChatArtifactData,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import { emitEvent } from 'cli/ai/json-events';

type ChatArtifactCallback = ( artifact: StudioChatArtifactData ) => void | Promise< void >;

let chatArtifactCallback: ChatArtifactCallback | null = null;

export function setChatArtifactCallback( callback: ChatArtifactCallback | null ) {
	chatArtifactCallback = callback;
}

export async function emitChatArtifact( artifact: StudioChatArtifactData ): Promise< void > {
	await chatArtifactCallback?.( artifact );
	emitEvent( {
		type: 'chat.artifact',
		timestamp: new Date().toISOString(),
		artifact,
	} );
}

export async function emitChatArtifactWidgets(
	widgets: readonly StudioChatArtifactWidgetDraft[] | undefined
): Promise< StudioChatArtifactData | null > {
	const artifactWidgets = cloneChatArtifactWidgets( widgets );
	if ( artifactWidgets.length === 0 ) {
		return null;
	}

	const artifact: StudioChatArtifactData = {
		version: STUDIO_CHAT_ARTIFACT_VERSION,
		id: randomUUID(),
		widgets: artifactWidgets,
	};

	await emitChatArtifact( artifact );
	return artifact;
}

function cloneChatArtifactWidgets(
	widgets: readonly StudioChatArtifactWidgetDraft[] | undefined
): StudioChatArtifactWidgetDraft[] {
	if ( ! widgets?.length ) {
		return [];
	}

	return widgets.map( ( widget ) => ( {
		type: widget.type,
		widgetProps: { ...widget.widgetProps },
		...( widget.shapeProps ? { shapeProps: { ...widget.shapeProps } } : {} ),
	} ) );
}

interface FileWritingTool {
	execute( toolCallId: string, params: { path?: unknown }, ...rest: unknown[] ): Promise< unknown >;
}

/**
 * Wraps a file-writing tool so that writing a site's DESIGN.md opens the design
 * system in the preview: the design system changed, so that is what to look at.
 */
export function withDesignSystemPreview< TTool extends FileWritingTool >(
	tool: TTool,
	cwd: string
): TTool {
	return {
		...tool,
		async execute( toolCallId: string, params: { path?: unknown }, ...rest: unknown[] ) {
			const result = await tool.execute( toolCallId, params, ...rest );
			const filePath = path.resolve( cwd, String( params.path ) );
			if (
				path.basename( filePath ) === 'DESIGN.md' &&
				existsSync( path.join( path.dirname( filePath ), 'wp-content' ) )
			) {
				await emitChatArtifactWidgets( [
					{ type: 'site-preview', widgetProps: { path: DESIGN_SYSTEM_PREVIEW_PATH } },
				] ).catch( () => undefined );
			}
			return result;
		},
	};
}
