import { describe, expect, it } from 'vitest';
import { getToolDetail, getToolDisplayName } from '../tools';

describe( 'tool display helpers', () => {
	it( 'keeps terminal command triggers short', () => {
		expect( getToolDisplayName( 'Bash' ) ).toBe( 'Run terminal command' );
		expect(
			getToolDetail( 'Bash', {
				command: "cat > /tmp/now-playing-draft.txt << 'ENDOFPOST'",
			} )
		).toBe( '' );
	} );
} );
