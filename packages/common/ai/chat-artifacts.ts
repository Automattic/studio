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

// The widgetProps the checkpoint agent tools attach to their results (see
// `apps/cli/ai/tools/checkpoints.ts`), rendered as a chip in the transcript.
export interface CheckpointArtifactProps {
	checkpointId: string;
	siteId: string;
	label: string | null;
	trigger: string;
	toolName: string | null;
	// Epoch milliseconds.
	createdAt: number;
}

export function getCheckpointArtifactProps(
	widget: StudioChatArtifactWidgetDraft
): CheckpointArtifactProps | null {
	if ( widget.type !== 'checkpoint' ) {
		return null;
	}
	const { checkpointId, siteId, label, trigger, toolName, createdAt } = widget.widgetProps;
	if (
		typeof checkpointId !== 'string' ||
		typeof siteId !== 'string' ||
		typeof trigger !== 'string' ||
		typeof createdAt !== 'number'
	) {
		return null;
	}
	return {
		checkpointId,
		siteId,
		label: typeof label === 'string' && label ? label : null,
		trigger,
		toolName: typeof toolName === 'string' && toolName ? toolName : null,
		createdAt,
	};
}

export function isCheckpointArtifactWidget( widget: StudioChatArtifactWidgetDraft ): boolean {
	return getCheckpointArtifactProps( widget ) !== null;
}
