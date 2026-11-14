import type { AnthropicConfig } from './anthropic/config';
import type { GeminiConfig } from './gemini/config';
import type { GithubCopilotConfig } from './github-copilot/config';
import type { AiModelId } from './models';
import type { OpenaiConfig } from './openai/config';
import type { SpacefastConfig } from './spacefast/config';
import type { Space } from './spacefast/descriptor';
import type { WpcomConfig } from './wpcom/config';
import type { PullSyncOptions, PushSyncOptions, SyncSite } from './wpcom/sites/site';
import type { XaiConfig } from './xai/config';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { z } from 'zod';

export type ProviderId =
	| 'wpcom'
	| 'anthropic'
	| 'openai'
	| 'gemini'
	| 'github-copilot'
	| 'xai'
	| 'spacefast';

// The providers that serve AI models.
export type AiProviderId = 'wpcom' | 'anthropic' | 'openai' | 'gemini' | 'github-copilot' | 'xai';

// What Studio stores for each provider.
export interface ProviderConfigs {
	wpcom: WpcomConfig;
	anthropic: AnthropicConfig;
	openai: OpenaiConfig;
	gemini: GeminiConfig;
	'github-copilot': GithubCopilotConfig;
	xai: XaiConfig;
	spacefast: SpacefastConfig;
}

// The remote sites of each provider that offers them.
export interface ProviderSites {
	wpcom: SyncSite;
	spacefast: Space;
}

export type SitesProviderId = keyof ProviderSites;

// A provider's remote site, or the base every remote site shares.
export type ProviderSite< Id extends ProviderId > = Id extends SitesProviderId
	? ProviderSites[ Id ]
	: RemoteSite;

export interface AiModel< Id extends string = string > {
	// Stable, stored in sessions; the same id in two providers is the same model.
	id: Id;
	label: () => string;
	// Defaults to true. Text-only models must not advertise vision they lack:
	// screenshot tool results are images.
	supportsImages?: boolean;
	// UI gating only: pickers disable the model unless purchased AI credits
	// remain (Automatticians exempt). The provider enforces access.
	requiresPaidAiCredits?: boolean;
}

// The values a connection form asks for: a flat object of strings. Each field's
// metadata (`.meta()`) gives its `title`, `description` and `examples`, and
// `writeOnly: true` marks a secret, which is never shown back.
export type ConnectInputSchema = z.ZodObject< Record< string, z.ZodType< string > > >;

// One way a provider's account connects. Studio hands what the user gave, or
// what came back from the provider's site, to the provider's `connect` with the
// method's id, and the provider turns it into the config to store.
export type ConnectMethod = {
	// Stable: stored configs record it.
	id: string;
	// What the user picks to connect this way, such as "API key".
	label: () => string;
	// What to do before connecting, in Markdown.
	instructions?: () => string;
} & (
	| // A form rendered from `input`.
	{ kind: 'form'; input: () => ConnectInputSchema }
	// Approving access on the provider's site, which redirects back to the app:
	// the Studio sign-in, which each app receives its own way.
	| { kind: 'redirect' }
	// Signing in on the provider's site, which redirects back to an address on
	// this computer where Studio listens.
	| { kind: 'loopback' }
	// Approving a code on the provider's site while Studio waits.
	| { kind: 'device' }
);

// What surfaces show of a connected account; never the credential itself.
export interface AccountDetails {
	// The method it connected with.
	method: string;
	// Who or what is connected, such as an email or the start of a key.
	summary?: string;
	// Something to know when using it, such as whose plan pays for it.
	note?: string;
	// The provider's models this account can run, when its plan decides which: surfaces offer
	// only these. Without it, the account runs every model the provider lists.
	models?: AiModelId[];
	links?: { label: string; url: string }[];
}

// A connection `start` began on the provider's site: the user goes to `url`,
// approving `code` when there is one, and `connect` takes `handoff` back.
export interface PendingConnect {
	url: string;
	code?: string;
	handoff: Record< string, string >;
}

// What a sign-in starts from. `hostId` stays the same on this computer, and
// `remembered` is what the provider's `remember` kept from an earlier sign-in.
export interface ConnectContext {
	// Where a loopback sign-in comes back to.
	redirectUri?: string;
	hostId: string;
	remembered?: Record< string, string >;
}

// How Studio presents a provider's remote sites, so the publish panel names no provider.
export interface ProviderSitesInfo< Site extends RemoteSite = RemoteSite > {
	// The largest archive a push sends, in bytes.
	maxPushSize?: number;
	// Whether Studio pulls a site back; without it, Studio only publishes.
	pull: boolean;
	// Whether a push or pull can include only part of the site.
	selective: boolean;
	// What a push sends: the site's WordPress archive, or a static export of its
	// pages, which needs the site to run on native PHP: Studio on the web can't make one.
	content: 'archive' | 'static';
	// How a new site is made: a checkout on the provider's site, which then
	// connects the site to the local one, or created right away from Studio.
	newSite: 'checkout' | 'create';
	// What the panel says before a site is connected.
	intro: { title: () => string; description: () => string; learnMoreUrl: string };
	// Facts about a connected site, and links to manage it on the provider.
	describe( site: Site ): {
		details: { title: string; value: string }[];
		links: { title: string; url: string }[];
	};
	// Why the site can't be published to or pulled from now, or null.
	issue( site: Site, direction: 'push' | 'pull' ): string | null;
	// Something to know before pushing the local site, which doesn't block it.
	pushWarning?( site: Site, local: { multisite?: boolean } ): string | null;
	// Whether the site keeps backups a selective pull can browse.
	hasBackups?( site: Site ): boolean;
	// Fills stored connections in from the account's current sites.
	withDetails< Connection extends Site >( connections: Connection[], sites: Site[] ): Connection[];
}

// A provider as surfaces show it: browser-safe data, from `getProvider`.
export interface Provider< Config = unknown, Site extends RemoteSite = RemoteSite > {
	id: ProviderId;
	// Brand name, not translated.
	label: string;
	description?: () => string;
	learnMoreUrl?: string;
	// The provider's mark: an SVG document, which may draw in `currentColor`.
	icon?: string;
	// The provider's logo in its brand colors: a square SVG document that fills its canvas,
	// which surfaces round into a tile like an app icon. Surfaces fall back to `icon` without one.
	logo?: string;
	account: {
		// What Studio stores.
		configSchema: z.ZodType< Config >;
		// The first is the default.
		methods: readonly [ ConnectMethod, ...ConnectMethod[] ];
		describe( config: Config ): AccountDetails;
		// When the config stops working, in milliseconds since the epoch.
		expiresAt?( config: Config ): number | undefined;
		// What to keep once the provider rejects the config, so signing in again
		// continues the same registration with it; never a credential.
		remember?( config: Config ): Record< string, string > | undefined;
	};
	ai?: {
		models: readonly AiModel< AiModelId >[];
		defaultModel: AiModelId;
		// The default when the account has paid AI credits left.
		paidDefaultModel?: AiModelId;
	};
	sites?: ProviderSitesInfo< Site >;
}

// Everything the runtime needs to register one model with pi.
export interface AiConnection {
	piProvider: string;
	apiKey: string;
	headers?: Record< string, string >;
	model: Model< Api >;
	// The upstream alias sent on the wire when it differs from the model id.
	requestModelId?: string;
	// Replaces a stream error's message; `undefined` keeps it.
	rewriteError?: ( message: string ) => string | undefined;
}

export interface GenerateImageRequest {
	prompt: string;
	aspectRatio?: string;
}

export interface GenerateImageResult {
	ok: boolean;
	bytes?: Uint8Array;
	error?: string;
	// Rejected by a safety filter; rewriting the prompt may get it through.
	filtered?: boolean;
}

// What a push sends: the site's WordPress archive (a Blob in the page, a
// readable stream of the file in Node), or a static export of its pages, each
// file read when the provider uploads it.
export type PushContent =
	| { kind: 'archive'; file: Blob | { pipe: unknown }; name: string; size: number }
	| { kind: 'files'; files: PushFile[] };

export interface PushFile {
	// Relative to the export's root, with `/` separators.
	path: string;
	size: number;
	read(): Promise< Uint8Array >;
}

// The steps of a push on the provider's side, after Studio built the content.
// `progress` is the step's own percentage, when the provider reports one.
export interface PushStatus {
	phase: 'uploading' | 'creatingRemoteBackup' | 'applyingChanges' | 'finishing' | 'launching';
	progress?: number;
}

// What Studio reads of any provider's remote site.
export interface RemoteSite {
	id: string | number;
	name: string;
	url: string;
}

// Sends local sites to a provider's sites and brings them back. The provider
// owns the remote side; Studio builds the content and applies what it pulls.
export interface SitesServices< Config, Site extends RemoteSite > {
	// The sites the account can sync with. A deleted site stays in the list
	// while it is connected (`connectedIds`).
	list(
		config: Config | undefined,
		options?: { connectedIds?: Site[ 'id' ][]; planRequired?: boolean }
	): Promise< Site[] >;
	// A new site to push to, for a provider that can create one.
	create?( config: Config | undefined, options: { name: string } ): Promise< Site >;
	// A launch error means the import succeeded; callers keep the publish intent
	// for a retry and must not show the site as published yet.
	push(
		config: Config | undefined,
		site: Pick< Site, 'id' | 'name' >,
		content: PushContent,
		options: PushSyncOptions,
		onStatus: ( status: PushStatus ) => void,
		signal?: AbortSignal
	): Promise< void | { launchError: string } >;
	pull?: {
		// Backs the site up remotely and resolves with where to download the
		// archive. `onProgress` gets the backup's percentage.
		backup(
			config: Config | undefined,
			site: Pick< Site, 'id' >,
			options: PullSyncOptions,
			onProgress: ( percent: number ) => void,
			signal?: AbortSignal
		): Promise< { url: string; size: number } >;
		// The site's export API, which a local Reprint reads the site through.
		// Opening it also reports whether the site has Studio's key.
		openExporter(
			config: Config | undefined,
			site: Pick< Site, 'id' | 'url' >
		): Promise< { apiUrl: string; hasKey: boolean } >;
		installExporterKey(
			config: Config | undefined,
			site: Pick< Site, 'id' >,
			publicKey: string
		): Promise< void >;
		// The latest backup's id, and the raw entries of one of its folders.
		latestBackupId( config: Config | undefined, site: Pick< Site, 'id' > ): Promise< string >;
		listBackupFiles(
			config: Config | undefined,
			site: Pick< Site, 'id' >,
			backupId: string,
			path: string
		): Promise< Record< string, unknown > >;
	};
}

// What a provider does, for the hosts that run operations: from `getProviderServices`.
export interface ProviderServices< Config = unknown, Site extends RemoteSite = RemoteSite > {
	id: ProviderId;
	account: {
		// Starts connecting with a method that signs in on the provider's site
		// (`loopback` or `device`).
		start?( method: string, context: ConnectContext ): Promise< PendingConnect >;
		// Checks what the user gave: a form's values, a redirect's parameters, or
		// a started connection's `handoff`, with a loopback redirect's parameters.
		// Returns the config to store; throws ConnectError when it fails.
		connect( method: string, input: Record< string, string > ): Promise< Config >;
		// A renewed config when its credential is about to expire, which Studio
		// stores; undefined while the config still works.
		refresh?( config: Config ): Promise< Config | undefined >;
		// Cleans up on the provider's side before Studio removes the config.
		disconnect?( config: Config ): Promise< void >;
	};
	ai?: {
		model(
			config: Config | undefined,
			model: AiModelId,
			options: { sessionId?: string }
		): Promise< AiConnection >;
		// Whether `generateImages` works with this config; defaults to true.
		canGenerateImages?( config: Config ): boolean;
		// Results keep the requests' order; a failure never aborts the rest.
		generateImages?(
			config: Config | undefined,
			requests: GenerateImageRequest[],
			onResult?: ( index: number, result: GenerateImageResult ) => void
		): Promise< GenerateImageResult[] >;
	};
	sites?: SitesServices< Config, Site >;
}
