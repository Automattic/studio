import { z } from 'zod';

export const SITE_RUNTIME_PLAYGROUND = 'playground';
export const SITE_RUNTIME_NATIVE_PHP = 'native-php';

export const siteRuntimeSchema = z.enum( [ SITE_RUNTIME_PLAYGROUND, SITE_RUNTIME_NATIVE_PHP ] );
export type SiteRuntime = z.infer< typeof siteRuntimeSchema >;
