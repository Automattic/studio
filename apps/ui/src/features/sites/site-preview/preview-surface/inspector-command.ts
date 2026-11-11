import { INSPECTOR_COMMAND_EVENT } from '@studio/agent/protocol/inspector/page-script';
import { __ } from '@wordpress/i18n';
import type { SiteAnnotations } from '@/features/annotations';
import type { AnnotationTool } from '@studio/agent/protocol/inspector/shortcuts';

function dispatchCommand( detail: unknown ): string {
	return `window.dispatchEvent(new CustomEvent(${ JSON.stringify(
		INSPECTOR_COMMAND_EVENT
	) }, { detail: ${ JSON.stringify( detail ) } }));`;
}

// The page script that mirrors the notes into the page, in the theme's accent
// as `element` resolves it.
export function buildInspectorCommandScript(
	annotations: SiteAnnotations,
	element: Element,
	tool: AnnotationTool
): string {
	const theme = getComputedStyle( element );
	// Only notes picked on a page. Told about a note on the design system or
	// in an email, the page would report it off screen and hide its editor.
	const notes = annotations.notes.filter( ( note ) => note.url );
	return dispatchCommand( {
		active: annotations.active,
		tool,
		areaSelection: true,
		busy: !! ( annotations.preparing || annotations.sending ),
		blockedNavigation: annotations.blockedNavigation ?? 0,
		editingId: notes.some( ( note ) => note.id === annotations.editingId )
			? annotations.editingId
			: null,
		notes: notes.map(
			( { id, number, selector, url, documentRect, point, staged, kind, drawing } ) => ( {
				id,
				kind,
				drawing,
				number,
				selector,
				url,
				documentRect,
				point,
				pending: ! staged,
			} )
		),
		annotationLabel: __( 'Annotation' ),
		pendingAnnotationLabel: __( 'Pending annotation' ),
		fontFamily: '"Studio Annotation", system-ui',
		accent: theme.getPropertyValue( '--accent' ).trim(),
		penColor:
			theme.getPropertyValue( '--accent-solid' ).trim() ||
			theme.getPropertyValue( '--accent' ).trim(),
		onAccent: theme.getPropertyValue( '--accent-foreground' ).trim(),
		destructive: theme.getPropertyValue( '--destructive' ).trim(),
		onDestructive: theme.getPropertyValue( '--destructive-foreground' ).trim(),
		motionDuration: theme.getPropertyValue( '--motion-duration-surface' ).trim(),
		motionEasing: theme.getPropertyValue( '--motion-ease-enter' ).trim(),
	} );
}

export function buildClearSelectionScript( selectionId: string ): string {
	return dispatchCommand( { clearSelection: selectionId } );
}
