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

export function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

// Legacy transcript markers. take_screenshot used to append its media widget
// payload to the tool result text behind these prefixes; artifacts are now
// emitted structurally, so the markers survive only in old persisted sessions.
const MEDIA_WIDGET_PAYLOAD_MARKERS = [ 'mediaWidgetPayload=', 'mediaWidgetPayloads=' ] as const;

export function stripMediaWidgetPayloadLines( text: string ): string {
	return text
		.split( '\n' )
		.filter(
			( line ) => ! MEDIA_WIDGET_PAYLOAD_MARKERS.some( ( marker ) => line.startsWith( marker ) )
		)
		.join( '\n' )
		.trim();
}

export function getMediaAltText( widget: StudioChatArtifactWidgetDraft, fallback: string ): string {
	const { alt } = widget.widgetProps;
	return typeof alt === 'string' && alt.trim() ? alt : fallback;
}

export function getLocalMediaPath( widget: StudioChatArtifactWidgetDraft ): string | null {
	const { source } = widget.widgetProps;
	if ( ! isRecord( source ) || source.type !== 'local' || typeof source.path !== 'string' ) {
		return null;
	}
	return source.path;
}

export function getSafeMediaUrl( widget: StudioChatArtifactWidgetDraft ): string | null {
	const { url } = widget.widgetProps;
	if ( typeof url !== 'string' ) {
		return null;
	}
	try {
		const parsed = new URL( url );
		return [ 'http:', 'https:', 'data:' ].includes( parsed.protocol ) ? url : null;
	} catch {
		return null;
	}
}

export function isRenderableMediaWidget( widget: StudioChatArtifactWidgetDraft ): boolean {
	return (
		widget.type === 'media' &&
		widget.widgetProps.mediaKind === 'image' &&
		( Boolean( getLocalMediaPath( widget ) ) || Boolean( getSafeMediaUrl( widget ) ) )
	);
}
