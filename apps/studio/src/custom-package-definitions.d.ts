/// <reference types="@testing-library/jest-dom/vitest" />

declare module '*.png' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.jpg' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.jpeg' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.gif' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.svg' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.riv' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.riv?url' {
	const url: string;
	export default url;
}

declare module '*.css';

declare module '*.css?url' {
	const url: string;
	export default url;
}

declare module '*.wasm' {
	const dataUri: function;
	export default dataUri;
}

declare module 'monaco-editor/esm/vs/editor/editor.api.js' {
	export * from 'monaco-editor';
}

declare module 'monaco-editor/esm/vs/basic-languages/*/*.js';

declare module 'monaco-editor/esm/vs/basic-languages/css/css.js';

declare module 'monaco-editor/esm/vs/basic-languages/html/html.js';

declare module 'monaco-editor/esm/vs/basic-languages/ini/ini.js';

declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js';

declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js';

declare module 'monaco-editor/esm/vs/basic-languages/php/php.js';

declare module 'monaco-editor/esm/vs/basic-languages/scss/scss.js';

declare module 'monaco-editor/esm/vs/basic-languages/shell/shell.js';

declare module 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js';

declare module 'monaco-editor/esm/vs/basic-languages/xml/xml.js';

declare module 'monaco-editor/esm/vs/basic-languages/yaml/yaml.js';

declare module 'monaco-editor/esm/vs/basic-languages/*/*.contribution.js';

declare module 'monaco-editor/esm/vs/language/*/monaco.contribution.js';

declare module 'wpcom-xhr-request';
