/**
 * This file contains translations for strings used in external libraries
 * that we don't control directly. By including these strings here,
 * they will be picked up by the translation extraction process.
 */

import { __ } from '@wordpress/i18n';

/**
 * These translations are not used directly in code.
 */
function _getAdditionalPhrases() {
	// Navigation strings used in external components like Guide
	const navigationStrings = {
		next: __( 'Next' ),
		previous: __( 'Previous' ),
	};

	return {
		...navigationStrings,
	};
}
