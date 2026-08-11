/**
 * This file contains translations for strings used in external libraries
 * that we don't control directly. By including these strings here,
 * they will be picked up by the translation extraction process.
 */

import { __ } from '@wordpress/i18n';

// These module-level calls exist only so the translation extractor picks up the
// strings; their return values are intentionally discarded, so they can never go
// stale and the studio/no-module-level-translations rule allows them.
// Navigation strings used in external components like Guide
__( 'Next' );
__( 'Previous' );
