import { describe, expect, it } from 'vitest';
import { initStudioTheme, theme } from 'cli/ai/theme';

describe( 'initStudioTheme', () => {
	it( 'renders the pending tool background as the success background', () => {
		initStudioTheme();
		expect( theme.bg( 'toolPendingBg', 'x' ) ).toBe( theme.bg( 'toolSuccessBg', 'x' ) );
		expect( theme.bg( 'toolErrorBg', 'x' ) ).not.toBe( theme.bg( 'toolSuccessBg', 'x' ) );
	} );
} );
