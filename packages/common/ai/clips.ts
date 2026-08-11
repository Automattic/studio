/**
 * Serializes composer clips into the prompt block that rides along with the
 * user's message. The clips' captures travel separately as image
 * attachments named `clip-N-<grain>.jpg` (see `getComposerClipImageName`);
 * the block pairs each clip's semantics with its image by that name.
 *
 * Written for the agent, so intentionally not localized.
 */

import { getComposerClipImageName, type ComposerClipAttachment } from './composer-attachments';

function truncateText( text: string, maxLength: number ): string {
	if ( text.length <= maxLength ) {
		return text;
	}
	return `${ text.slice( 0, maxLength - 1 ) }...`;
}

function describeGrain( clip: ComposerClipAttachment ): string {
	switch ( clip.grain ) {
		case 'element': {
			const tag = clip.target?.tag ? `<${ clip.target.tag }>` : 'element';
			const text = clip.target?.nearbyText?.trim();
			return `Element clip: ${ tag }${ text ? ` - "${ truncateText( text, 120 ) }"` : '' }`;
		}
		case 'region': {
			const zoom =
				clip.zoom && clip.zoom > 1 ? ` at ${ Math.round( clip.zoom * 10 ) / 10 }x zoom` : '';
			const covered = clip.coveredTag ? ` around <${ clip.coveredTag }>` : '';
			return `Region clip${ zoom }${ covered }`;
		}
		case 'page':
			return 'Full-page clip';
		case 'console':
			return `Console clip${
				typeof clip.entryCount === 'number' ? ` (${ clip.entryCount } entries)` : ''
			}`;
	}
}

function describeContext( clip: ComposerClipAttachment ): string[] {
	const lines: string[] = [];
	const page = clip.context.url || clip.context.pathname;
	if ( page ) {
		lines.push( `- Page: ${ page }` );
	}
	const state: string[] = [];
	if ( clip.context.realm && clip.context.realm !== 'frontend' ) {
		state.push( clip.context.realm === 'admin' ? 'WP Admin' : 'phpMyAdmin' );
	}
	if ( clip.context.viewportWidth ) {
		state.push( `${ clip.context.viewportWidth }px viewport` );
	}
	if ( clip.context.colorScheme ) {
		state.push( `${ clip.context.colorScheme } mode` );
	}
	if ( state.length ) {
		lines.push( `- Preview state: ${ state.join( ', ' ) }` );
	}
	return lines;
}

/**
 * The prompt block appended (invisibly to the user) after the typed message
 * when the composer holds clips. Returns null when there are none.
 */
export function formatClipsAsPrompt( clips: ComposerClipAttachment[] ): string | null {
	if ( clips.length === 0 ) {
		return null;
	}

	const lines: string[] = [
		'',
		'---',
		'',
		`The user attached ${
			clips.length === 1 ? '1 clip' : `${ clips.length } clips`
		} from the site preview. A clip is a captured piece of the site the user is pointing at — treat each one as part of the message above.`,
		'',
		'When you reference a clip back to the user, identify it by what is visible on the page (or by its number), not by selector. Use selectors and raw clip data only for implementation.',
		'',
		'## Clips',
		'',
	];

	clips.forEach( ( clip, index ) => {
		const number = index + 1;
		lines.push( `### ${ number }. ${ describeGrain( clip ) }` );
		lines.push( ...describeContext( clip ) );
		if ( clip.comment ) {
			lines.push( `- Comment: ${ clip.comment }` );
		}
		if ( clip.target?.selector ) {
			lines.push( `- Selector: \`${ clip.target.selector }\`` );
		}
		if ( clip.grain === 'region' && clip.coveredSelector ) {
			lines.push( `- Near: \`${ clip.coveredSelector }\`` );
		}
		if ( clip.dataBase64 ) {
			lines.push( `- Capture: attached image \`${ getComposerClipImageName( clip, number ) }\`` );
		}
		if ( clip.filePath ) {
			lines.push( `- Entries: attached file \`${ clip.name }\`` );
		}
		if ( clip.grain === 'element' && clip.target ) {
			lines.push(
				'',
				'```json',
				JSON.stringify(
					{
						selector: clip.target.selector,
						tag: clip.target.tag,
						nearbyText: clip.target.nearbyText,
						computedStyles: clip.target.computedStyles,
						documentRect: clip.documentRect,
					},
					null,
					2
				),
				'```'
			);
		}
		lines.push( '' );
	} );

	return lines.join( '\n' ).trimEnd();
}

/** Short display line shown as the visible message when the user sends
 * clips without any typed text. */
export function formatClipsFallbackMessage( count: number ): string {
	return count === 1
		? 'Sent 1 clip from the site preview'
		: `Sent ${ count } clips from the site preview`;
}
