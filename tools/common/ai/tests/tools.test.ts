import { describe, expect, it } from 'vitest';
import { getToolDetail, getToolDisplayName } from '../tools';

describe( 'tool display helpers', () => {
	// Surfaces without an expandable input panel (CLI, Studio Code tab) rely
	// on the shared detail to show what command ran; ui-classic hides it
	// locally in favor of its own input panel.
	it( 'shows the Bash command as the shared detail', () => {
		expect( getToolDisplayName( 'Bash' ) ).toBe( 'Run' );
		expect( getToolDetail( 'Bash', { command: 'wp plugin activate jetpack' } ) ).toBe(
			'wp plugin activate jetpack'
		);
	} );

	it( 'truncates long Bash commands', () => {
		const command = `cat > /tmp/now-playing-draft.txt << 'ENDOFPOST' with much more text after it`;
		const detail = getToolDetail( 'Bash', { command } );
		expect( detail.length ).toBeLessThanOrEqual( 60 );
		expect( detail.endsWith( '…' ) ).toBe( true );
	} );
} );
