import type { AnthropicConfig } from './anthropic/config';
import type { AiModelId } from './models';
import type { OpenaiConfig } from './openai/config';
import type { SpacefastConfig } from './spacefast/config';
import type { Space } from './spacefast/site';
import type { WpcomConfig } from './wpcom/config';
import type { PullSyncOptions, PushSyncOptions, SyncSite } from './wpcom/site';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { z } from 'zod';

export type ProviderId = 'wpcom' | 'anthropic' | 'openai' | 'spacefast';

// The providers that serve AI models.
export type AiProviderId = 'wpcom' | 'anthropic' | 'openai';

// What Studio stores for each provider.
export interface ProviderConfigs {
	wpcom: WpcomConfig;
	anthropic: AnthropicConfig;
	openai: OpenaiConfig;
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

export interface RedirectOptions {
	// Where the provider sends the user back, with the result in the URL.
	redirectUri: string;
	locale: string;
	// Echoed back with the result, to tell the redirect is the one this started.
	state?: string;
	// Create an account before approving access.
	signup?: boolean;
}

// How the user connects an account. Studio passes what it collected to the
// provider's `connect`, which turns it into the config to store.
export type ProviderConnection =
	// A form rendered from `input`.
	| { kind: 'form'; input: () => ConnectInputSchema }
	// Approving access on the provider's site, which redirects back to the app
	// with the result in the URL's parameters.
	| { kind: 'redirect'; redirectUrl( options: RedirectOptions ): string }
	// Approving a code on the provider's site, while Studio waits for the
	// approval: the provider's `startConnect` returns the code and where to
	// approve it, and `connect` takes it back and resolves once approved.
	| { kind: 'device' }
	// Signing in on the provider's site, which redirects back to an address on
	// this computer where Studio listens: Studio passes that address to the
	// provider's `startLoopbackConnect`, and `connect` takes the redirect's
	// parameters with the authorization's `verifier` and the `redirectUri`.
	| { kind: 'loopback' };

// One of several ways a provider's account connects, for the user to pick.
// `connect` receives the chosen one's id as `input.method`, and the config
// records it as `method`.
export type ConnectionMethod = ProviderConnection & { id: string; label: () => string };

// A pending device sign-in: the user approves `userCode` at `verificationUrl`.
export interface DeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUrl: string;
	// Seconds between checks for the approval.
	interval: number;
	expiresAt: string;
}

// A pending loopback sign-in: the user signs in at `url`, and the provider
// redirects the browser back to Studio, echoing `state`.
export interface LoopbackAuthorization {
	url: string;
	state: string;
	// Never sent through the browser, such as a PKCE code verifier.
	verifier: string;
}

// How Studio presents a provider's remote sites, so the publish panel names no provider.
export interface SitesDescriptor< Site extends RemoteSite = RemoteSite > {
	// The largest archive a push sends, in bytes.
	maxPushSize?: number;
	// Whether Studio pulls a site back; without it, Studio only publishes.
	pull: boolean;
	// Whether a push or pull can include only part of the site.
	selective: boolean;
	// Whether a push publishes a static export of the site, which needs the
	// site to run on native PHP: Studio on the web can't make one.
	exportsStaticSite?: boolean;
	// How a new site is made: a checkout on the provider's site, which then
	// connects the site to the local one, or created right away from Studio.
	newSite: 'checkout' | 'create';
	// What the panel says before a site is connected.
	intro: { title: () => string; description: () => string; learnMoreUrl: string };
	// Facts about a connected site, and links to manage it on the provider.
	details( site: Site ): { title: string; value: string }[];
	links( site: Site ): { title: string; url: string }[];
	// Why the site can't be published to or pulled from now, or null.
	issue( site: Site, direction: 'push' | 'pull' ): string | null;
	// Something to know before pushing the local site, which doesn't block it.
	pushWarning?( site: Site, local: { multisite?: boolean } ): string | null;
	// Whether the site keeps backups a selective pull can browse.
	hasBackups?( site: Site ): boolean;
	// Fills stored connections in from the account's current sites.
	withDetails< Connection extends Site >( connections: Connection[], sites: Site[] ): Connection[];
}

export interface ProviderDescriptor< Config = unknown, Site extends RemoteSite = RemoteSite > {
	id: ProviderId;
	// Brand name, not translated.
	label: string;
	description?: () => string;
	learnMoreUrl?: string;
	// The provider's mark, drawn in the text color: an SVG path in a 24×24 box.
	icon?: string;
	// What Studio stores for this provider.
	configSchema: z.ZodType< Config >;
	connection: ProviderConnection | ConnectionMethod[];
	// What to show for a connected account; never the credential itself.
	summarize?( config: Config ): string;
	// What to keep once the provider rejects the config, so signing in again
	// continues the same registration with it; never a credential.
	remember?( config: Config ): Record< string, string >;
	// The connect button's label, when the provider's branding sets one.
	connectLabel?: () => string;
	ai?: {
		models: readonly AiModel< AiModelId >[];
		defaultModel: AiModelId;
		// The default when the account has paid AI credits left.
		paidDefaultModel?: AiModelId;
		// Defaults to true. Studio on the web runs the agent in the page, which
		// can't offer a provider that signs in through this computer.
		inPage?: boolean;
		// For models that use the user's plan with the provider: what to say
		// next to the model, and where the user manages that usage.
		planUsage?: { label: () => string; manageUrl: string };
	};
	sites?: SitesDescriptor< Site >;
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

// Results keep the requests' order; a failure never aborts the rest.
export type GenerateImages< Config > = (
	config: Config | undefined,
	requests: GenerateImageRequest[],
	onResult?: ( index: number, result: GenerateImageResult ) => void
) => Promise< GenerateImageResult[] >;

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
export interface SitesService< Config, Site extends RemoteSite > {
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

export interface Provider< Config = unknown, Site extends RemoteSite = RemoteSite > {
	descriptor: ProviderDescriptor< Config, Site >;
	// Checks what the user gave, a form's values or a redirect's parameters, and
	// returns the config to store. Throws InvalidCredentialError when it fails.
	// Without `input.method`, a provider with several methods takes its first.
	connect( input: Record< string, string > ): Promise< Config >;
	// Starts a device sign-in, for a provider whose connection kind is `device`.
	startConnect?(): Promise< DeviceAuthorization >;
	// Starts a loopback sign-in, for a provider whose connection kind is `loopback`.
	// `hostId` stays the same on this computer, and `remembered` is what the
	// descriptor's `remember` kept, which `connect` gets back too.
	startLoopbackConnect?(
		redirectUri: string,
		context: { hostId: string; remembered?: Record< string, string > }
	): Promise< LoopbackAuthorization >;
	// Cleans up on the provider's side before Studio removes the config.
	disconnect?( config: Config ): Promise< void >;
	// A renewed config when its credential is about to expire, which Studio
	// stores; undefined while the config still works.
	refresh?( config: Config ): Promise< Config | undefined >;
	ai?: {
		// Whether a selection that isn't ready falls back to another ready
		// provider instead of asking for credentials.
		fallbackWhenNotReady: boolean;
		connect(
			config: Config | undefined,
			model: AiModelId,
			options: { sessionId?: string }
		): Promise< AiConnection >;
		generateImages?: GenerateImages< Config >;
	};
	sites?: SitesService< Config, Site >;
}
