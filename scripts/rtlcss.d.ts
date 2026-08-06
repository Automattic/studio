// rtlcss ships no types, and `@types/rtlcss` still describes the v3 API. Only
// the one call `build-phpmyadmin-theme.ts` makes is declared here.
declare module 'rtlcss' {
	const rtlcss: {
		process( css: string, options?: Record< string, unknown > ): string;
	};
	export default rtlcss;
}
