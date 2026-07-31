import { validateStudioInspectorAnnotations } from '@studio/common/ai/inspector-annotations';
import type { StudioInspectorAnnotation } from '@studio/common/ai/inspector-annotations';

export interface AnnotationDoneResult {
	capturedAt: number;
	url: string;
	annotations: StudioInspectorAnnotation[];
}

export function validateAnnotationDoneResult( value: unknown ): AnnotationDoneResult {
	if ( typeof value !== 'object' || value === null ) {
		throw new Error( 'The annotation browser returned an invalid result.' );
	}
	const result = value as Partial< AnnotationDoneResult >;
	if (
		typeof result.capturedAt !== 'number' ||
		! Number.isFinite( result.capturedAt ) ||
		typeof result.url !== 'string' ||
		result.url.length > 10_000 ||
		! Array.isArray( result.annotations )
	) {
		throw new Error( 'The annotation browser returned an invalid result.' );
	}

	validateStudioInspectorAnnotations( result.annotations );

	return result as AnnotationDoneResult;
}
