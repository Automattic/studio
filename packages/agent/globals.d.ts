// `wpcom-xhr-request` ships no types; `@studio/common` code the agent imports
// uses it. Each package declares it for its own compilation.
declare module 'wpcom-xhr-request';

// A file's text, as Vite imports it with `?raw`.
declare module '*?raw' {
	const content: string;
	export default content;
}

// Files' text, as Vite bundles them with `import.meta.glob( …, { query: '?raw', import: 'default', eager: true } )`.
interface ImportMeta {
	glob(
		pattern: string,
		options: { query: '?raw'; import: 'default'; eager: true }
	): Record< string, string >;
}
