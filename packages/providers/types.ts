import type { AnthropicConfig } from './anthropic/config';
import type { AiModelId } from './models';
import type { WpcomConfig } from './wpcom/config';
import type { PullSyncOptions, PushSyncOptions, SyncSite } from './wpcom/site';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { z } from 'zod';

export type ProviderId = 'wpcom' | 'anthropic';

// What Studio stores for each provider.
export interface ProviderConfigs {
	wpcom: WpcomConfig;
	anthropic: AnthropicConfig;
}

// The remote sites of each provider that offers them.
export interface ProviderSites {
	wpcom: SyncSite;
}

export type SitesProviderId = keyof ProviderSites;

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
	| { kind: 'redirect'; redirectUrl( options: RedirectOptions ): string };

export interface ProviderDescriptor< Config = unknown > {
	id: ProviderId;
	// Brand name, not translated.
	label: string;
	description?: () => string;
	learnMoreUrl?: string;
	// What Studio stores for this provider.
	configSchema: z.ZodType< Config >;
	connection: ProviderConnection;
	// What to show for a connected account; never the credential itself.
	summarize?( config: Config ): string;
	ai?: {
		models: readonly AiModel< AiModelId >[];
		defaultModel: AiModelId;
		// The default when the account has paid AI credits left.
		paidDefaultModel?: AiModelId;
	};
	sites?: {
		// The largest archive a push sends, in bytes.
		maxPushSize?: number;
	};
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

// The archive of a local site a push sends: a Blob in the page, a readable
// stream of the file in Node.
export interface PushArchive {
	file: Blob | { pipe: unknown };
	name: string;
	size: number;
}

// The steps of a push on the provider's side, after Studio built the archive.
// `progress` is the step's own percentage, when the provider reports one.
export interface PushStatus {
	phase: 'uploading' | 'creatingRemoteBackup' | 'applyingChanges' | 'finishing';
	progress?: number;
}

// Sends local sites to a provider's sites and brings them back. The provider
// owns the remote side; Studio builds the archives and applies what it pulls.
// What Studio reads of any provider's remote site.
export interface RemoteSite {
	id: unknown;
	name: string;
	url: string;
}

export interface SitesService< Config, Site extends RemoteSite > {
	// The sites the account can sync with. A deleted site stays in the list
	// while it is connected (`connectedIds`).
	list(
		config: Config | undefined,
		options?: { connectedIds?: Site[ 'id' ][]; planRequired?: boolean }
	): Promise< Site[] >;
	push(
		config: Config | undefined,
		site: Pick< Site, 'id' | 'name' >,
		archive: PushArchive,
		options: PushSyncOptions,
		onStatus: ( status: PushStatus ) => void,
		signal?: AbortSignal
	): Promise< void >;
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
		// The PHP version the site runs, when the provider can tell.
		phpVersion(
			config: Config | undefined,
			site: Pick< Site, 'id' >
		): Promise< string | undefined >;
	};
}

export interface Provider< Config = unknown, Site extends RemoteSite = RemoteSite > {
	descriptor: ProviderDescriptor< Config >;
	// Checks what the user gave, a form's values or a redirect's parameters, and
	// returns the config to store. Throws InvalidCredentialError when it fails.
	connect( input: Record< string, string > ): Promise< Config >;
	// Cleans up on the provider's side before Studio removes the config.
	disconnect?( config: Config ): Promise< void >;
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
