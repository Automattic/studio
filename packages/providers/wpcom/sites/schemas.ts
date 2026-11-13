import { z } from 'zod';

// WordPress.com /me/sites endpoint response schemas
export const sitesEndpointSiteSchema = z.object( {
	ID: z.number(),
	is_wpcom_atomic: z.boolean(),
	name: z.string(),
	URL: z.string(),
	launch_status: z.string().optional(),
	is_coming_soon: z.boolean().optional(),
	is_private: z.boolean().optional(),
	jetpack: z.boolean().optional(),
	is_deleted: z.boolean(),
	hosting_provider_guess: z.string().optional(),
	environment_type: z
		.enum( [ 'production', 'staging', 'development', 'sandbox', 'local' ] )
		.nullable()
		.optional(),
	is_a8c: z.boolean().optional(),
	icon: z
		.object( {
			img: z.string(),
			ico: z.string(),
		} )
		.optional(),
	options: z
		.object( {
			created_at: z.string(),
			wpcom_staging_blog_ids: z.array( z.number() ),
			// WordPress.com only returns software_version for Atomic/Jetpack
			// sites; Simple sites (e.g. Business plans not yet transferred to
			// Atomic, or Free/Personal plans) omit it. Requiring it here would
			// silently drop every Simple site from the synced-sites list.
			software_version: z.string().optional(),
		} )
		.optional(),
	capabilities: z
		.object( {
			manage_options: z.boolean(),
		} )
		.optional(),
	plan: z
		.object( {
			expired: z.boolean().optional(),
			features: z.object( {
				active: z.array( z.string() ),
				available: z.record( z.string(), z.array( z.string() ) ).optional(),
			} ),
			is_free: z.boolean().optional(),
			product_id: z.coerce.number(),
			product_name_short: z.string(),
			product_slug: z.string(),
			user_is_owner: z.boolean().optional(),
		} )
		.optional(),
} );

export type SitesEndpointSite = z.infer< typeof sitesEndpointSiteSchema >;

// Permissive wrapper for the /me/sites response (to fail gracefully per-site)
export const sitesEndpointResponseSchema = z.object( {
	sites: z.array( z.unknown() ),
	total: z.number().optional(),
	page: z.number().optional(),
	per_page: z.number().optional(),
} );

// Pull backup API schemas
export const pullSiteResponseSchema = z.object( {
	success: z.boolean(),
	backup_id: z.number(),
} );

export const syncBackupResponseSchema = z.object( {
	status: z.enum( [ 'in-progress', 'finished', 'failed' ] ),
	download_url: z.string().nullable().optional(),
	percent: z.number(),
} );

// Push import API schemas
const importFailedResponseSchema = z.object( {
	status: z.literal( 'failed' ),
	success: z.boolean(),
	error: z.string(),
	error_data: z
		.object( {
			vp_restore_status: z.string().nullable(),
			vp_restore_message: z.string().nullable(),
			vp_rewind_id: z.string().nullable(),
		} )
		.nullable(),
} );

const importWorkingResponseSchema = z.object( {
	status: z.enum( [
		'started',
		'initial_backup_started',
		'initial_backup_finished',
		'archive_import_started',
		'archive_import_finished',
		'finished',
	] ),
	success: z.boolean(),
	backup_progress: z.number().nullable(),
	import_progress: z.number().nullable(),
} );

export const importResponseSchema = z.discriminatedUnion( 'status', [
	importWorkingResponseSchema,
	importFailedResponseSchema,
] );

export type ImportResponse = z.infer< typeof importResponseSchema >;
