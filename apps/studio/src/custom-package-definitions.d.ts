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

declare module '*.webp' {
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

declare module '*.css';

declare module '*.css?url' {
	const url: string;
	export default url;
}

declare module '*.wasm' {
	const dataUri: function;
	export default dataUri;
}

declare module 'wpcom-xhr-request';
