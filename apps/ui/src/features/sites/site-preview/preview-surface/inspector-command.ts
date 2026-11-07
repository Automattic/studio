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
	// Only notes picked on a page. Told about a note on the design system or
	// in an email, the page would report it off screen and hide its editor.
	const notes = annotations.notes.filter( ( note ) => note.url );
	const detail = {
		active: annotations.active,
		blockedNavigation: annotations.blockedNavigation ?? 0,
		editingId: notes.some( ( note ) => note.id === annotations.editingId )
			? annotations.editingId
			: null,
		notes: notes.map( ( { id, number, selector, url, documentRect, point, staged } ) => ( {
			id,
			number,
			selector,
			url,
			documentRect,
			point,
			pending: ! staged,
		} ) ),
		annotationLabel: __( 'Annotation' ),
		pendingAnnotationLabel: __( 'Pending annotation' ),
		fontFamily: '"Studio Annotation", system-ui',
		accent: theme.getPropertyValue( '--accent' ).trim(),
		onAccent: theme.getPropertyValue( '--accent-foreground' ).trim(),
		destructive: theme.getPropertyValue( '--destructive' ).trim(),
		onDestructive: theme.getPropertyValue( '--destructive-foreground' ).trim(),
		motionDuration: theme.getPropertyValue( '--motion-duration-surface' ).trim(),
		motionEasing: theme.getPropertyValue( '--motion-ease-enter' ).trim(),
	};
	return `window.dispatchEvent(new CustomEvent(${ JSON.stringify(
		INSPECTOR_COMMAND_EVENT
	) }, { detail: ${ JSON.stringify( detail ) } }));`;
}
