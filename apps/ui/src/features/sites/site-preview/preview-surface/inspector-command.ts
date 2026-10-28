import { INSPECTOR_COMMAND_EVENT } from '@studio/agent/protocol/inspector/page-script';
import { __ } from '@wordpress/i18n';
import type { SiteAnnotations } from '@/features/annotations';

// The page script that mirrors the notes into the page, in the theme's accent
// as `element` resolves it.
export function buildInspectorCommandScript(
	annotations: SiteAnnotations,
	element: Element
): string {
	const theme = getComputedStyle( element );
	const detail = {
		active: annotations.active,
		editingId: annotations.editingId,
		notes: annotations.notes.map( ( { id, number, selector, url, documentRect, point } ) => ( {
			id,
			number,
			selector,
			url,
			documentRect,
			point,
		} ) ),
		annotationLabel: __( 'Annotation' ),
		accent: theme.getPropertyValue( '--accent' ).trim(),
		onAccent: theme.getPropertyValue( '--accent-foreground' ).trim(),
	};
	return `window.dispatchEvent(new CustomEvent(${ JSON.stringify(
		INSPECTOR_COMMAND_EVENT
	) }, { detail: ${ JSON.stringify( detail ) } }));`;
}
