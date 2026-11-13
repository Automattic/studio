import {
	getCapabilities,
	resetCapabilitiesCache,
	setCapabilities,
	type TUI,
} from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { backgroundOn, initStudioTheme, refineStudioTheme, theme } from 'cli/ai/theme';

describe( 'initStudioTheme', () => {
	it( 'renders the pending tool background as the success background', () => {
		initStudioTheme();
		expect( theme.bg( 'toolPendingBg', 'x' ) ).toBe( theme.bg( 'toolSuccessBg', 'x' ) );
		expect( theme.bg( 'toolErrorBg', 'x' ) ).not.toBe( theme.bg( 'toolSuccessBg', 'x' ) );
	} );
} );

describe( 'backgroundOn', () => {
	it.each( [
		{
			terminal: { r: 40, g: 44, b: 52 },
			color: 'userMessageBg',
			expected: { r: 57, g: 61, b: 68 },
		},
		{
			terminal: { r: 255, g: 255, b: 255 },
			color: 'userMessageBg',
			expected: { r: 235, g: 235, b: 235 },
		},
		{
			terminal: { r: 40, g: 44, b: 52 },
			color: 'toolSuccessBg',
			expected: { r: 49, g: 60, b: 60 },
		},
		{ terminal: { r: 40, g: 44, b: 52 }, color: 'toolErrorBg', expected: { r: 65, g: 52, b: 60 } },
		{ terminal: { r: 0, g: 0, b: 0 }, color: 'selectedBg', expected: { r: 31, g: 31, b: 31 } },
	] as const )( 'sets $color off a $terminal terminal', ( { terminal, color, expected } ) => {
		expect( backgroundOn( terminal, color ) ).toEqual( expected );
	} );
} );

describe( 'refineStudioTheme', () => {
	it( 'sets the rows off the background the terminal reports', async () => {
		setCapabilities( { ...getCapabilities(), trueColor: true } );
		initStudioTheme();
		const tui = {
			queryTerminalColors: async () => ( { background: { r: 40, g: 44, b: 52 } } ),
		} as unknown as TUI;

		expect( await refineStudioTheme( tui ) ).toBe( true );
		expect( theme.bg( 'userMessageBg', 'x' ) ).toBe( '\x1b[48;2;57;61;68mx\x1b[49m' );
		expect( theme.bg( 'toolPendingBg', 'x' ) ).toBe( theme.bg( 'toolSuccessBg', 'x' ) );
		resetCapabilitiesCache();
	} );

	it( "keeps the theme's backgrounds on a terminal without truecolor", async () => {
		setCapabilities( { ...getCapabilities(), trueColor: false } );
		initStudioTheme();
		const before = theme.bg( 'userMessageBg', 'x' );
		const tui = {
			queryTerminalColors: async () => ( { background: { r: 40, g: 44, b: 52 } } ),
		} as unknown as TUI;

		await refineStudioTheme( tui );
		expect( theme.bg( 'userMessageBg', 'x' ) ).toBe( before );
		resetCapabilitiesCache();
	} );
} );
