/**
 * Cleans up error messages by removing stack traces and debug markers for user-facing display
 */
export function cleanErrorMessage( errorMessage: string ): string {
	if ( ! errorMessage ) {
		return errorMessage;
	}

	let cleanedMessage = errorMessage
		.split( '\n' )
		.filter( ( line ) => {
			const trimmed = line.trim();
			// Remove stack trace elements, debug markers, and technical details
			return (
				! trimmed.startsWith( '#' ) &&
				! trimmed.startsWith( 'Stack trace:' ) &&
				! /^\s*\d+\s/.test( line ) &&
				! /^\/.*\.php\(\d+\)/.test( trimmed ) &&
				! /^\s*thrown\s+in\s+/.test( trimmed ) &&
				! /^\s*at\s/.test( trimmed ) &&
				! /^===\s*(Stdout|Stderr)\s*===$/i.test( trimmed ) &&
				! /^<br\s*\/?>$/i.test( trimmed ) && // Remove HTML line breaks
				! /^<\/?b>$/i.test( trimmed ) && // Remove HTML bold tags
				! /^in\s+\/.*\.php/.test( trimmed ) && // Remove "in /path/file.php" lines
				trimmed.length > 0
			); // Remove empty lines
		} )
		.join( '\n' )
		.trim();

	// Remove HTML tags and clean up PHP error formatting
	cleanedMessage = cleanedMessage
		.replace( /<br\s*\/?>/gi, '\n' ) // Convert HTML breaks to newlines
		.replace( /<\/?b>/gi, '' ) // Remove bold tags
		.replace( /\*\*(Fatal error|Error|Warning|Notice)\*\*:\s*/gi, '$1: ' ) // Clean up error type formatting
		.replace( /\s*in\s+\/.*\.php.*$/gm, '' ) // Remove file path references at end of lines
		.trim();

	// Extract just the meaningful error message
	const lines = cleanedMessage.split( '\n' ).filter( ( line ) => line.trim() );

	// Look for the core error message, prioritizing SQL errors and meaningful descriptions
	const meaningfulLine = lines.find( ( line ) => {
		const trimmed = line.trim();
		return (
			( trimmed.includes( 'SQLSTATE' ) ||
				trimmed.includes( 'already exists' ) ||
				trimmed.includes( 'duplicate' ) ||
				( trimmed.length > 20 && ! trimmed.includes( 'PHP.run()' ) ) ) &&
			! trimmed.includes( '/wordpress/' ) &&
			! trimmed.includes( '.php:' )
		);
	} );

	// If we found a meaningful error, use it; otherwise use the first line
	if ( meaningfulLine ) {
		return meaningfulLine.replace( /^(Fatal error|Error|Warning|Notice):\s*/i, '' ).trim();
	}

	return lines
		.slice( 0, 1 )
		.join( '\n' )
		.replace( /^(Fatal error|Error|Warning|Notice):\s*/i, '' )
		.trim();
}
