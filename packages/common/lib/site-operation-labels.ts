import { __ } from '@wordpress/i18n';
import type { SiteOperationKind } from '@studio/common/lib/site-operation';

// Kept out of `site-operation.ts` so the wire schema stays free of display
// copy — `cli-events.ts` imports that module, and everything parsing a site
// record would otherwise pull @wordpress/i18n along with it.

/** Present continuous, for progress UI ("Importing…"). */
export function getSiteOperationLabel( kind: SiteOperationKind ): string {
	switch ( kind ) {
		case 'start':
			return __( 'Starting' );
		case 'stop':
			return __( 'Stopping' );
		case 'delete':
			return __( 'Deleting' );
		case 'import':
			return __( 'Importing' );
		case 'pull':
			return __( 'Pulling' );
		case 'settings':
			return __( 'Saving settings' );
		case 'export':
			return __( 'Exporting' );
		case 'push':
			return __( 'Pushing' );
		case 'duplicate':
			return __( 'Duplicating' );
	}
}

// Noun phrase for sentences naming an operation. The article is part of the
// string so translators get a whole phrase to agree with, rather than an "a/an"
// the code would have to guess at.
export function getSiteOperationNoun( kind: SiteOperationKind ): string {
	switch ( kind ) {
		case 'start':
			return __( 'a site start' );
		case 'stop':
			return __( 'a site stop' );
		case 'delete':
			return __( 'a site deletion' );
		case 'import':
			return __( 'an import' );
		case 'pull':
			return __( 'a pull' );
		case 'settings':
			return __( 'a settings change' );
		case 'export':
			return __( 'an export' );
		case 'push':
			return __( 'a push' );
		case 'duplicate':
			return __( 'a duplication' );
	}
}
