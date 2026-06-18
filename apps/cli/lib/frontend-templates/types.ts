/**
 * A frontend template is a starter for the static frontend of a headless site. Each template
 * knows how to scaffold its project files and which subfolder it serves as the public web root
 * (e.g. `public` for plain static, `dist`/`out` for build-tool templates).
 */
export interface FrontendTemplate {
	/** Stable identifier, persisted on the site record (e.g. `static`). */
	id: string;
	/** Human-readable label for menus. */
	label: string;
	/**
	 * The served web root, relative to the frontend project directory (`<site>/frontend`). This is
	 * what the frontend server exposes — never the project root, so tooling/source stay private.
	 */
	servedSubdir: string;
	/**
	 * Scaffold the template's files into the frontend project directory (`<site>/frontend`).
	 * Implementations must be idempotent — skip files that already exist.
	 */
	scaffold( frontendDir: string, siteName: string ): Promise< void >;
}
