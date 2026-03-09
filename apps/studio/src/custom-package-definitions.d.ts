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

declare module '*.css?url' {
	const url: string;
	export default url;
}

declare module '*.wasm' {
	const dataUri: function;
	export default dataUri;
}

declare module 'wpcom-xhr-request';

// TODO: Remove this once https://github.com/WordPress/wordpress-playground/pull/3035 has landed
// and a new `@wp-playground/storage` has been published to npm
declare module '@wp-playground/storage';
