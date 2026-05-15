import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const SCRATCHPAD_WIDGET_TYPE = 'scratchpad';

export const SCRATCHPAD_SCOPES = [ 'page', 'pattern', 'block' ] as const;

export type ScratchpadScope = ( typeof SCRATCHPAD_SCOPES )[ number ];

export type ScratchpadWidgetProps = {
	html: string;
	title: string;
	scope: ScratchpadScope;
	description?: string;
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
		( candidate.reference === undefined || isScratchpadReference( candidate.reference ) )
	);
}

export function isScratchpadScope( value: unknown ): value is ScratchpadScope {
	return SCRATCHPAD_SCOPES.includes( value as ScratchpadScope );
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
