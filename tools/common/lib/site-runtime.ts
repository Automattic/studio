import { z } from 'zod';

export const SITE_RUNTIME_PLAYGROUND = 'playground';
export const SITE_RUNTIME_NATIVE_PHP = 'native-php';

export const siteRuntimeSchema = z.enum( [ SITE_RUNTIME_PLAYGROUND, SITE_RUNTIME_NATIVE_PHP ] );
export type SiteRuntime = z.infer< typeof siteRuntimeSchema >;

export function getSiteRuntime( site: { runtime?: SiteRuntime } ): SiteRuntime {
	return site.runtime ?? SITE_RUNTIME_NATIVE_PHP;
}

// User-facing short names for the runtimes, used by the CLI (--runtime) and the app UI.
export const SITE_MODE_NATIVE = 'native' as const;
export const SITE_MODE_SANDBOX = 'sandbox' as const;

export const siteModeSchema = z.enum( [ SITE_MODE_NATIVE, SITE_MODE_SANDBOX ] );
export type SiteMode = z.infer< typeof siteModeSchema >;

export function siteRuntimeFromMode( mode: SiteMode ): SiteRuntime {
	return mode === SITE_MODE_NATIVE ? SITE_RUNTIME_NATIVE_PHP : SITE_RUNTIME_PLAYGROUND;
}

export function siteModeFromRuntime( runtime: SiteRuntime ): SiteMode {
	return runtime === SITE_RUNTIME_NATIVE_PHP ? SITE_MODE_NATIVE : SITE_MODE_SANDBOX;
}
