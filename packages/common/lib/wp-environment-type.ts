import { z } from 'zod';

export const WP_ENVIRONMENT_TYPE_LOCAL = 'local' as const;
export const WP_ENVIRONMENT_TYPE_DEVELOPMENT = 'development' as const;
export const WP_ENVIRONMENT_TYPE_STAGING = 'staging' as const;
export const WP_ENVIRONMENT_TYPE_PRODUCTION = 'production' as const;

export const wpEnvironmentTypeSchema = z.enum( [
	WP_ENVIRONMENT_TYPE_LOCAL,
	WP_ENVIRONMENT_TYPE_DEVELOPMENT,
	WP_ENVIRONMENT_TYPE_STAGING,
	WP_ENVIRONMENT_TYPE_PRODUCTION,
] );
export type WpEnvironmentType = z.infer< typeof wpEnvironmentTypeSchema >;

export const WP_ENVIRONMENT_TYPES = wpEnvironmentTypeSchema.options;

// Studio's loader mu-plugin falls back to "local" for sites whose wp-config.php
// doesn't define the constant, so unset sites behave as local today.
export function getWpEnvironmentType( site: {
	environmentType?: WpEnvironmentType;
} ): WpEnvironmentType {
	return site.environmentType ?? WP_ENVIRONMENT_TYPE_LOCAL;
}
