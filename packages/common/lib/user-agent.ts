// The client name every Studio surface sends to WordPress.com, with the
// version when the host knows it: `WordPressStudio/1.2.3`.
export function getStudioUserAgent( version?: string ): string {
	return version ? `WordPressStudio/${ version }` : 'WordPressStudio';
}
