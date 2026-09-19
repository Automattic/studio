// src/lib/publish/types.ts
//
// The publish boundary. A target receives a directory of liberated HTML and
// returns where it went live. Nothing about a specific host belongs in the
// liberation core — targets depend on the HTML contract, never the reverse.
//
export interface PublishOptions {
	/** Directory to publish. Its contents become the site root. */
	directory: string;
	/** Credential for an owned publish. Anonymous when omitted. */
	token?: string | undefined;
	log?: ( ( message: string ) => void ) | undefined;
}

export interface PublishResult {
	target: string;
	/** Stable URL for the published site. */
	liveUrl: string;
	/** URL for this exact version, when the target versions publishes. */
	versionUrl?: string | undefined;
	/** File count and total bytes archived and sent in the request. A target
	 * that reports storage outcomes separately may store fewer — see `accepted`. */
	files: number;
	bytes: number;
	/**
	 * Files the destination actually stored, when it reports that separately
	 * from what was sent. Undefined when the target gives no such breakdown,
	 * in which case `files` is the only figure available.
	 */
	accepted?: number | undefined;
	/** Archive paths the destination reports it declined to store, when it
	 * names them. A non-empty list means the live site is missing content
	 * that the archive carried. */
	ignored?: string[] | undefined;
	/**
	 * One-time link that transfers ownership of an anonymous publish, with its
	 * deadline. Present only when the target created an unclaimed space.
	 */
	claim?: { url: string; expiresAt?: string | undefined } | undefined;
	/** True when the target reports the site is not publicly readable yet. */
	private?: boolean | undefined;
	/** Target-specific notes worth showing the operator. */
	notes: string[];
}

export interface PublishTarget {
	name: string;
	/** Optional destination attribution. Receives an isolated staging copy;
	 * the canonical liberated artifact remains attribution-free and unchanged. */
	attribution?(options: { directory: string }): Promise<void>;
	publish( options: PublishOptions ): Promise< PublishResult >;
}

export class PublishError extends Error {
	readonly code: string;
	readonly requestId: string | undefined;

	constructor( input: { code: string; message: string; requestId?: string | undefined } ) {
		super( input.message );
		this.name = 'PublishError';
		this.code = input.code;
		this.requestId = input.requestId;
	}
}
