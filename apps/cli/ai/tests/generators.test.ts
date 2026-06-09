import { describe, expect, it } from 'vitest';
import {
	PAGE_CONTENT_MAX_TOKENS,
	THEME_JSON_MAX_TOKENS,
} from 'cli/ai/tools/site-generator/generators';

describe( 'site generator model budgets', () => {
	it( 'keeps enough output budget for complete theme.json files', () => {
		expect( THEME_JSON_MAX_TOKENS ).toBeGreaterThanOrEqual( 12_000 );
	} );

	it( 'keeps enough output budget for designed page bodies', () => {
		expect( PAGE_CONTENT_MAX_TOKENS ).toBeGreaterThanOrEqual( 16_000 );
	} );
} );
