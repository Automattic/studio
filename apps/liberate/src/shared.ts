// Types and helpers shared by the server and the browser bundle.

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export const STEPS = [ 'scan', 'capture', 'import', 'package' ] as const;
export type Step = ( typeof STEPS )[ number ];

export interface JobCounts {
	pages: number;
}

export type FileKind = 'site';

/** What the API exposes about a job. */
export interface JobView {
	id: string;
	url: string;
	host: string;
	status: JobStatus;
	/** The site's own name, once known and when it has a usable one. */
	siteName?: string;
	/** Display name of the source platform, once known (e.g. "Wix"). */
	platform?: string;
	step?: Step;
	/** Overall progress, 0–1. */
	progress: number;
	/** One human-readable line about what is happening right now. */
	detail?: string;
	/** 1-based position in the queue while queued. */
	queuePosition?: number;
	counts?: JobCounts;
	/** Set when the copy finished with known gaps. */
	warning?: string;
	error?: string;
	/** Sizes in bytes of the downloadable files. */
	files?: Partial< Record< FileKind, number > >;
	createdAt: number;
	expiresAt?: number;
}

export interface PublicConfig {
	retentionHours: number;
	turnstileSiteKey?: string;
	/** Jobs are simulated and the downloads are placeholders. */
	simulated?: boolean;
}

const PLATFORMS: Record< string, string > = {
	wix: 'Wix',
	squarespace: 'Squarespace',
	shopify: 'Shopify',
	webflow: 'Webflow',
	'godaddy-wm': 'GoDaddy',
	weebly: 'Weebly',
	hubspot: 'HubSpot',
	hostinger: 'Hostinger',
};

export const PLATFORM_NAMES = Object.values( PLATFORMS );

/** Display name for a data-liberation platform id; undefined for unknown/generic sites. */
export function platformName( id: string | undefined ): string | undefined {
	return id ? PLATFORMS[ id ] : undefined;
}

const HOSTED_SUFFIXES: [ string, string ][] = [
	[ 'wixsite.com', 'Wix' ],
	[ 'wixstudio.com', 'Wix' ],
	[ 'squarespace.com', 'Squarespace' ],
	[ 'myshopify.com', 'Shopify' ],
	[ 'webflow.io', 'Webflow' ],
	[ 'godaddysites.com', 'GoDaddy' ],
	[ 'weebly.com', 'Weebly' ],
	[ 'hs-sites.com', 'HubSpot' ],
	[ 'hubspotpagebuilder.com', 'HubSpot' ],
	[ 'zyrosite.com', 'Hostinger' ],
	[ 'hostingersite.com', 'Hostinger' ],
];

/** Guess the platform from a platform-owned hostname. Custom domains return undefined. */
export function platformFromHost( host: string ): string | undefined {
	const lower = host.toLowerCase();
	return HOSTED_SUFFIXES.find(
		( [ suffix ] ) => lower === suffix || lower.endsWith( '.' + suffix )
	)?.[ 1 ];
}

export function isJobId( value: string ): boolean {
	return /^[A-Za-z0-9_-]{22}$/.test( value );
}
