import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const SCRATCHPAD_WIDGET_TYPE = 'scratchpad';

export const SCRATCHPAD_SCOPES = [ 'page', 'pattern', 'block' ] as const;
export const SCRATCHPAD_AGENT_STATUSES = [ 'idle', 'pending', 'running', 'done' ] as const;

export type ScratchpadScope = ( typeof SCRATCHPAD_SCOPES )[ number ];
export type ScratchpadAgentStatus = ( typeof SCRATCHPAD_AGENT_STATUSES )[ number ];

export type ScratchpadWidgetProps = {
	html: string;
	title: string;
	scope: ScratchpadScope;
	description?: string;
	lastSyncedDescription?: string;
	agentStatus?: ScratchpadAgentStatus;
	agentSessionId?: string;
	reference?: ScratchpadReference;
};

export type ScratchpadReference = {
	mediaId: number | null;
	url: string;
	alt: string;
};

export type ScratchpadWidget = DeskWidgetBase<
	typeof SCRATCHPAD_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ScratchpadWidgetProps
>;

export function isScratchpadWidgetProps( value: unknown ): value is ScratchpadWidgetProps {
	const candidate = value as Partial< ScratchpadWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.html === 'string' &&
		typeof candidate.title === 'string' &&
		isScratchpadScope( candidate.scope ) &&
		( candidate.description === undefined || typeof candidate.description === 'string' ) &&
		( candidate.lastSyncedDescription === undefined ||
			typeof candidate.lastSyncedDescription === 'string' ) &&
		( candidate.agentStatus === undefined || isScratchpadAgentStatus( candidate.agentStatus ) ) &&
		( candidate.agentSessionId === undefined || typeof candidate.agentSessionId === 'string' ) &&
		( candidate.reference === undefined || isScratchpadReference( candidate.reference ) )
	);
}

export function isScratchpadScope( value: unknown ): value is ScratchpadScope {
	return SCRATCHPAD_SCOPES.includes( value as ScratchpadScope );
}

export function isScratchpadAgentStatus( value: unknown ): value is ScratchpadAgentStatus {
	return SCRATCHPAD_AGENT_STATUSES.includes( value as ScratchpadAgentStatus );
}

function isScratchpadReference( value: unknown ): value is ScratchpadReference {
	const candidate = value as Partial< ScratchpadReference >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.url === 'string' &&
		typeof candidate.alt === 'string' &&
		( candidate.mediaId === null ||
			( typeof candidate.mediaId === 'number' &&
				Number.isInteger( candidate.mediaId ) &&
				candidate.mediaId >= 0 ) )
	);
}
