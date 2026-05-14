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
		( candidate.description === undefined || typeof candidate.description === 'string' )
	);
}

export function isScratchpadScope( value: unknown ): value is ScratchpadScope {
	return SCRATCHPAD_SCOPES.includes( value as ScratchpadScope );
}
