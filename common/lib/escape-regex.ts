const reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

export function escapeRegex( string: string ): string {
	return string ? string.replace( reRegExpChar, '\\$&' ) : string;
}
