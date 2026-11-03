import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	DESIGN_SYSTEM_PREVIEW_PATH,
	STUDIO_CHAT_ARTIFACT_VERSION,
	type StudioChatArtifactData,
	type StudioChatArtifactWidgetDraft,
} from '@studio/agent/protocol/chat-artifacts';
import type { StudioAgentUi } from '@studio/agent/node/host';

export async function emitChatArtifactWidgets(
	ui: StudioAgentUi,
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

	await ui.showArtifact( artifact );
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
	} ) );
}

interface FileWritingTool {
	description?: string;
	execute( toolCallId: string, params: { path?: unknown }, ...rest: unknown[] ): Promise< unknown >;
}

/**
 * Wraps a file-writing tool so that writing a site's DESIGN.md offers the design
 * system view from the chat.
 */
export function withDesignSystemPreview< TTool extends FileWritingTool >(
	tool: TTool,
	cwd: string,
	ui?: StudioAgentUi
): TTool {
	if ( ! ui ) {
		return tool;
	}

	return {
		...tool,
		description: `${
			tool.description ?? ''
		} After successfully updating a site's DESIGN.md, say "Updated the [Design System](${ DESIGN_SYSTEM_PREVIEW_PATH })." in your final reply. Studio renders this link as an inline chip that opens the site's design system. Keep this acknowledgment short; omit generic filler such as "to match" or "refreshed your preview". Include other details only when they explain a meaningful result or limitation. Do not add a separate update announcement.`,
		async execute( toolCallId: string, params: { path?: unknown }, ...rest: unknown[] ) {
			const result = await tool.execute( toolCallId, params, ...rest );
			const filePath = path.resolve( cwd, String( params.path ) );
			if (
				path.basename( filePath ) === 'DESIGN.md' &&
				existsSync( path.join( path.dirname( filePath ), 'wp-content' ) )
			) {
				await emitChatArtifactWidgets( ui, [
					{ type: 'site-preview', widgetProps: { path: DESIGN_SYSTEM_PREVIEW_PATH } },
				] ).catch( () => undefined );
			}
			return result;
		},
	};
}
