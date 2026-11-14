import {
	DESIGN_SYSTEM_PREVIEW_PATH,
	STUDIO_CHAT_ARTIFACT_VERSION,
	type StudioChatArtifactData,
	type StudioChatArtifactWidgetDraft,
} from '@studio/agent/protocol/chat-artifacts';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { StudioAgentHost, StudioAgentUi } from '@studio/agent/shared/host';

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
		id: crypto.randomUUID(),
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
	execute(
		toolCallId: string,
		params: { path?: unknown },
		...rest: unknown[]
	): Promise< AgentToolResult< unknown > >;
}

/**
 * Wraps a file-writing tool so that writing a site's DESIGN.md offers the design
 * system view from the chat.
 */
export function withDesignSystemPreview< TTool extends FileWritingTool >(
	tool: TTool,
	host: StudioAgentHost
): TTool {
	const { path, ui } = host;
	if ( ! ui ) {
		return tool;
	}
	return {
		...tool,
		description: `${
			tool.description ?? ''
		} After successfully updating a site's DESIGN.md, include [Design System](${ DESIGN_SYSTEM_PREVIEW_PATH }) within a natural sentence describing the result in your final reply.`,
		async execute( toolCallId: string, params: { path?: unknown }, ...rest: unknown[] ) {
			const result = await tool.execute( toolCallId, params, ...rest );
			const filePath = path.resolve( host.sitesRoot, String( params.path ) );
			if (
				! result.isError &&
				path.basename( filePath ) === 'DESIGN.md' &&
				( await host.files.isDirectory( path.join( path.dirname( filePath ), 'wp-content' ) ) )
			) {
				await emitChatArtifactWidgets( ui, [
					{ type: 'site-preview', widgetProps: { path: DESIGN_SYSTEM_PREVIEW_PATH } },
				] ).catch( () => undefined );
				return {
					...result,
					content: [
						...result.content,
						{
							type: 'text' as const,
							text: `The updated design system is available at [Design System](${ DESIGN_SYSTEM_PREVIEW_PATH }). Include this link within a natural sentence in your final reply.`,
						},
					],
				};
			}
			return result;
		},
	};
}
