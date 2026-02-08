/**
 * Shared types for site events between CLI and Studio app.
 *
 * The CLI emits these events via the `_events` command, and Studio
 * subscribes to them to maintain its site state without reading appdata.
 */
import { z } from 'zod';

/**
 * Site data included in events. This is the data Studio needs to display sites.
 */
export const siteDetailsSchema = z.object( {
	id: z.string(),
	name: z.string(),
	path: z.string(),
	port: z.number(),
	url: z.string(),
	phpVersion: z.string(),
	customDomain: z.string().optional(),
	enableHttps: z.boolean().optional(),
	adminUsername: z.string().optional(),
	adminPassword: z.string().optional(),
	adminEmail: z.string().optional(),
	isWpAutoUpdating: z.boolean().optional(),
	autoStart: z.boolean().optional(),
	enableXdebug: z.boolean().optional(),
} );

export type SiteDetails = z.infer< typeof siteDetailsSchema >;

export enum SITE_EVENTS {
	CREATED = 'site-created',
	UPDATED = 'site-updated',
	DELETED = 'site-deleted',
}

export const siteEventSchema = z.object( {
	event: z.enum( SITE_EVENTS ),
	siteId: z.string(),
	site: siteDetailsSchema.optional(),
	running: z.boolean(),
} );

export type SiteEvent = z.infer< typeof siteEventSchema >;
