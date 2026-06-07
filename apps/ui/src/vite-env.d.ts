/// <reference types="vite/client" />

interface ImportMetaEnv {
	// Base URL of the `studio web-server` backend the web connector talks to.
	readonly VITE_STUDIO_API_URL?: string;
	// Backend selector: 'secex' wires the hosted Studio Code endpoint connector
	// (browser → wpcom /studio-code/run); anything else uses the web-server.
	readonly VITE_STUDIO_BACKEND?: string;
	// Full URL of the wpcom Studio Code run endpoint (SecEx mode).
	readonly VITE_STUDIO_SECEX_RUN_URL?: string;
	// WordPress.com OAuth Bearer forwarded to the endpoint (SecEx mode).
	readonly VITE_STUDIO_WPCOM_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
