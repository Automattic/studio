export const STUDIO_CHAT_ARTIFACT_VERSION = 1 as const;

export interface StudioChatArtifactWidgetDraft {
	type: string;
	widgetProps: Record< string, unknown >;
	shapeProps?: Record< string, unknown >;
}

export interface StudioChatArtifactData {
	version: typeof STUDIO_CHAT_ARTIFACT_VERSION;
	id: string;
	widgets: StudioChatArtifactWidgetDraft[];
}

export function isStudioChatArtifactData( value: unknown ): value is StudioChatArtifactData {
	const candidate = value as Partial< StudioChatArtifactData >;
	return (
		isRecord( value ) &&
		candidate.version === STUDIO_CHAT_ARTIFACT_VERSION &&
		typeof candidate.id === 'string' &&
		Array.isArray( candidate.widgets ) &&
		candidate.widgets.every( isStudioChatArtifactWidgetDraft )
	);
}

export function isStudioChatArtifactWidgetDraft(
	value: unknown
): value is StudioChatArtifactWidgetDraft {
	const candidate = value as Partial< StudioChatArtifactWidgetDraft >;
	return (
		isRecord( value ) &&
		typeof candidate.type === 'string' &&
		isRecord( candidate.widgetProps ) &&
		( candidate.shapeProps === undefined || isRecord( candidate.shapeProps ) )
	);
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}
