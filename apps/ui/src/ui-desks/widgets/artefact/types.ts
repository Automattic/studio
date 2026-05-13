import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const ARTEFACT_WIDGET_TYPE = 'sd-artefact';

export const ARTEFACT_SCOPES = [ 'page', 'pattern', 'block' ] as const;

export type ArtefactScope = ( typeof ARTEFACT_SCOPES )[ number ];

export type ArtefactWidgetProps = {
	html: string;
	title: string;
	scope: ArtefactScope;
	description?: string;
};

export type ArtefactWidget = DeskWidgetBase<
	typeof ARTEFACT_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ArtefactWidgetProps
>;

export function isArtefactWidgetProps( value: unknown ): value is ArtefactWidgetProps {
	const candidate = value as Partial< ArtefactWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.html === 'string' &&
		typeof candidate.title === 'string' &&
		isArtefactScope( candidate.scope ) &&
		( candidate.description === undefined || typeof candidate.description === 'string' )
	);
}

export function isArtefactScope( value: unknown ): value is ArtefactScope {
	return ARTEFACT_SCOPES.includes( value as ArtefactScope );
}
