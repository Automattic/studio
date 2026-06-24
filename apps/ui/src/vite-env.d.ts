/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom/vitest" />

interface ImportMetaEnv {
	// Base URL of the Studio Web backend (`apps/hosted`) the web connector talks to.
	readonly VITE_STUDIO_API_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
