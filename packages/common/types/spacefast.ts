import { z } from 'zod';

export const spacefastAuthSchema = z
	.object( {
		apiKey: z.string(),
		expiresAt: z.string().nullable().optional(),
	} )
	.loose();

export type SpacefastAuth = z.infer< typeof spacefastAuthSchema >;

// A Space a local site publishes to, as persisted in `shared.json`.
export const spacefastConnectionSchema = z
	.object( {
		spaceId: z.string(),
		title: z.string(),
		liveUrl: z.string(),
		lastPublishedAt: z.number().optional(),
	} )
	.loose();

export type SpacefastConnection = z.infer< typeof spacefastConnectionSchema >;

export type SpacefastSpace = {
	id: string;
	title: string;
	slug: string;
	liveUrl: string;
	teamId: string;
	teamName: string;
};

export type SpacefastTeam = {
	id: string;
	name: string;
};

export const spacefastDeviceLoginSchema = z.object( {
	deviceCode: z.string(),
	userCode: z.string(),
	verificationUrl: z.string(),
	interval: z.number().positive(),
	expiresAt: z.string(),
} );

export type SpacefastDeviceLogin = z.infer< typeof spacefastDeviceLoginSchema >;

export type SpacefastPublishProgress =
	| { phase: 'exporting' | 'finalizing' }
	| { phase: 'uploading'; uploaded: number; total: number };

// Where to publish: an existing Space, or a new one created in a team.
export const spacefastPublishTargetSchema = z.union( [
	z.object( { spaceId: z.string().min( 1 ) } ),
	z.object( { teamId: z.string().min( 1 ), title: z.string().min( 1 ) } ),
] );

export type SpacefastPublishTarget = z.infer< typeof spacefastPublishTargetSchema >;
