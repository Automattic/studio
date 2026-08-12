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
		case 'settings':
			return __( 'Saving settings' );
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
		case 'settings':
			return __( 'a settings change' );
		case 'duplicate':
			return __( 'a duplication' );
	}
}
