// A PHP single-quoted string literal holding `value`.
export function phpQuote( value: string ): string {
	return `'${ value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" ) }'`;
}
