// src/index.ts
//
// The PUBLIC package entry — the import surface third-party consumers use:
//
//   import { registerPlatform, detectPlatform } from 'data-liberation';
//
// It exposes the Platform contract, the registration/lookup API, and the
// automatic-detection entry points. Internal orchestration (liberation, WXR,
// extraction loops, the MCP server) is deliberately NOT re-exported here;
// consumers extend the system by registering platforms, not by driving
// internals. package.json's `exports` map enforces this boundary.

// Importing the entry registers the built-in platforms (and the generic
// fallback) in the same registry consumer platforms join.
import './platform/builtins.js';

export {
	registerPlatform,
	registeredPlatforms,
	findPlatform,
	fallbackPlatform,
	resolvePlatform,
	UNKNOWN_PLATFORM_ID,
	PlatformRegistrationError,
	InvalidPlatformError,
	DuplicatePlatformError,
	ConflictingFallbackError,
} from './platform/registry.js';

export { detect as detectPlatform, detectFromUrl, detectFromHttp } from './lib/detect-platform/index.js';
export type {
	DetectionResult,
	FullDetectionResult,
} from './lib/detect-platform/index.js';

export type {
	Platform,
	PlatformDetection,
	PlatformUrlSignal,
	PlatformHttpSignal,
	PlatformSourceSignal,
	PlatformPathProbe,
	RegisterPlatformOptions,
} from './platform/types.js';
export type { LiberationHooks, LiberationContext } from './adapters/page-actions.js';
