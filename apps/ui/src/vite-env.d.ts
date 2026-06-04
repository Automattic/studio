/// <reference types="vite/client" />

interface ImportMetaEnv {
	// Base URL of the `studio web-server` backend the web connector talks to.
	readonly VITE_STUDIO_API_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
