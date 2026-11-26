import type { AnthropicConfig } from './anthropic/config';
import type { GeminiConfig } from './gemini/config';
import type { GithubCopilotConfig } from './github-copilot/config';
import type { LocalLlmConfig } from './local-llm/config';
import type { MetaConfig } from './meta/config';
import type { AiModelId, ThinkingLevel } from './models';
import type { OpenaiConfig } from './openai/config';
import type { OpenrouterConfig } from './openrouter/config';
import type { SpacefastConfig } from './spacefast/config';
import type { Space } from './spacefast/descriptor';
import type { SshSite } from './ssh/descriptor';
import type { WpcomConfig } from './wpcom/config';
import type { PullSyncOptions, PushSyncOptions, SyncSite } from './wpcom/sites/site';
import type { XaiConfig } from './xai/config';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';

// What Studio stores for each provider.
export interface ProviderConfigs {
	wpcom: WpcomConfig;
	anthropic: AnthropicConfig;
	openai: OpenaiConfig;
	gemini: GeminiConfig;
	'github-copilot': GithubCopilotConfig;
	meta: MetaConfig;
	xai: XaiConfig;
	openrouter: OpenrouterConfig;
	spacefast: SpacefastConfig;
	'local-llm': LocalLlmConfig;
	// No account: the user's own SSH setup reaches the sites.
	ssh: undefined;
}

export type ProviderId = keyof ProviderConfigs;

// The providers that serve AI models: all but the ones that only host sites.
export type AiProviderId = Exclude< ProviderId, 'spacefast' | 'ssh' >;

// The remote sites of each provider that offers them.
export interface ProviderSites {
	wpcom: SyncSite;
	spacefast: Space;
	ssh: SshSite;
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
	// Defaults to true. Whether a chat can set how much the model thinks (`ThinkingLevel`).
	thinking?: boolean;
}

// The values a form asks for: a flat object of strings. Each field's metadata (`.meta()`) gives
// its `title`, `description` and `examples`, and `writeOnly: true` marks a secret, which is never
// shown back. Surfaces read it with `getFormFields`.
export type FormSchema = z.ZodObject< Record< string, z.ZodType< string > > >;

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
	// Only a process on the user's computer can run it, such as the Desktop app, `studio ui`'s
	// server or the CLI: Studio running elsewhere (Studio Cloud) can't reach what it checks.
	hostOnly?: boolean;
} & (
	| // A form rendered from `input`.
	{ kind: 'form'; input: () => FormSchema }
	// Approving access on the provider's site, which redirects back to the app:
	// the Studio sign-in, which each app receives its own way.
	| { kind: 'redirect' }
	// Signing in on the provider's site, which redirects back to an address on
	// this computer where Studio listens.
	| { kind: 'loopback' }
	// Approving a code on the provider's site while Studio waits.
	| { kind: 'device' }
);

// What a provider looks like in the apps, from `getProviderUi` in `@studio/providers/ui`. Each part
// is optional: without it, the apps show their default.
export interface ProviderUi< Site extends RemoteSite = RemoteSite > {
	// The form describing a site of a provider with `sites.connect`.
	ConnectForm?: ComponentType< ConnectFormProps >;
	// What the publish panel shows under a connected site, such as its plan.
	SiteRows?: ComponentType< SiteRowsProps< Site > >;
	// What the publish panel asks before creating a site, such as its Spacefast team.
	NewSiteRows?: ComponentType< NewSiteRowsProps >;
}

export interface NewSiteRowsProps {
	// The choices so far, which Studio passes to the services' `create` and `creationVisibility`.
	input: Record< string, string >;
	disabled: boolean;
	onChange( input: Record< string, string > ): void;
	// Runs one of the services' actions on the computer.
	run( action: string, input?: Record< string, string > ): Promise< unknown >;
	// The panel's own picker row, so a provider's rows look like the rest.
	SelectRow: ComponentType< SelectRowProps >;
}

export interface SelectRowProps {
	icon: ReactNode;
	label: string;
	value: string;
	options: { value: string; label: string }[];
	disabled?: boolean;
	onChange( value: string ): void;
}

export interface SiteRowsProps< Site extends RemoteSite = RemoteSite > {
	site: Site;
	disabled: boolean;
	openUrl( url: string ): void;
	// The panel's own row, so a provider's rows look like the rest.
	Row: ComponentType< SiteRowProps >;
}

export interface SiteRowProps {
	icon: ReactNode;
	label: string;
	trailing?: ReactNode;
	disabled?: boolean;
	onClick(): void;
}

// What Studio gives a provider's own connect form.
export interface ConnectFormProps {
	disabled: boolean;
	// Studio is reaching the site the form described.
	pending: boolean;
	error?: string;
	// Reaches the site the values describe, with the services' `resolve`.
	onSubmit( input: Record< string, string > ): void;
	// Runs one of the services' actions on the computer.
	run( action: string, input?: Record< string, string > ): Promise< unknown >;
}

// What surfaces show of a connected account; never the credential itself.
export interface AccountDetails {
	// The method it connected with.
	method: string;
	// Who or what is connected, such as an email or the start of a key.
	summary?: string;
	// Something to know when using it, such as whose plan pays for it.
	note?: string;
	// The provider's models this account can run, when its plan or its owner decides which:
	// surfaces offer only these. Without it, the account runs every model the provider lists.
	models?: AccountModel[];
	links?: { label: string; url: string }[];
}

// A model an account offers. One from a provider's catalog carries what surfaces show of it.
export interface AccountModel {
	id: AiModelId;
	label?: string;
	supportsImages?: boolean;
	thinking?: boolean;
}

// A model in a provider's catalog, as the account's owner picks from it.
export interface CatalogModel {
	id: AiModelId;
	label: string;
	supportsImages: boolean;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
	// What tells it apart in a list, such as its price and context size.
	details?: string;
	// One of the models the provider lists, which run Studio Code's tools well.
	recommended?: boolean;
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

export interface SiteLink {
	title: string;
	url: string;
	// An SVG document drawn in `currentColor`; without it, an external-link icon.
	icon?: string;
}

// How Studio presents a provider's remote sites, so the publish panel names no provider.
export interface ProviderSitesInfo< Site extends RemoteSite = RemoteSite > {
	// What a site there is, in a few words, for the destination picker.
	summary: () => string;
	// Who can see the provider's sites, which the services' `visibility` reads and sets.
	visibility?: {
		options(
			current?: SiteVisibilityDetails[ 'visibility' ]
		): { value: SiteVisibility; label: string; description: string; disabled?: boolean }[];
		// Where the site's access is managed on the provider, when Studio can't set all of it.
		manage( site: Site ): SiteLink | undefined;
	};

	// The provider also builds previews; an upgraded one is a site the user keeps.
	previews?: {
		isUpgraded?( site: Site ): boolean;
	};
	// The largest archive a push sends, in bytes.
	maxPushSize?: number;
	// Whether Studio pulls a site back; without it, Studio only publishes.
	pull: boolean;
	// Whether a push or pull can include only part of the site.
	selective: boolean;
	// What a push sends: the site's WordPress archive, or a static export of its pages.
	content: 'archive' | 'static';
	// How a new site is made: a checkout on the provider's site, which then
	// connects the site to the local one, or created right away from Studio. Without it, the
	// user only connects sites they already have.
	newSite?: 'checkout' | 'create';
	// The form that describes a site the account doesn't list, which the services' `resolve` checks
	// by reaching the site. `hostOnly` as for an account's connect method.
	connect?: { input: () => FormSchema; hostOnly?: boolean };
	// What the panel says before a site is connected, and where to learn more about the provider.
	intro: { title: () => string; description: () => string; learnMoreUrl?: string };
	// Facts about a connected site, and links to manage it on the provider, in the order shown.
	describe( site: Site ): {
		details: { title: string; value: string }[];
		links: SiteLink[];
	};
	// Why the site can't be published to or pulled from now, or null.
	issue?( site: Site, direction: 'push' | 'pull' ): string | null;
	// Something to know before pushing the local site, which doesn't block it.
	pushWarning?( site: Site, local: { multisite?: boolean } ): string | null;
	// Whether the site keeps backups a selective pull can browse.
	hasBackups?( site: Site ): boolean;
	// Fills stored connections in from the account's current sites.
	withDetails?< Connection extends Site >( connections: Connection[], sites: Site[] ): Connection[];
}

// How a provider's account connects, and what surfaces show of it.
export interface ProviderAccount< Config > {
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
	// Who the config signs in as, when connections belong to one account: Studio lists a
	// connection only while the account that made it is connected.
	owner?( config: Config ): string | undefined;
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
	ai?: {
		models: readonly AiModel< AiModelId >[];
		defaultModel: AiModelId;
		// The default when the account has paid AI credits left.
		paidDefaultModel?: AiModelId;
		// Whether the account generates images; without it, the provider doesn't.
		generatesImages?( config: Config ): boolean;
		// The provider runs more models than it lists: the account's owner picks which to offer
		// from its catalog, whose ids start with one of `prefixes`, such as `openrouter/`.
		catalog?: { prefixes: readonly string[] };
		// The models run on a server the user runs: chats on them need no internet, and analytics
		// never name them, since the user does.
		local?: boolean;
	};
	sites?: ProviderSitesInfo< Site >;
	// Without one, such as SSH's, there is nothing to connect, and the provider counts as connected.
	account?: ProviderAccount< Config >;
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
	// `model.contextWindow` is exactly the context the server runs the model with: the runtime
	// compacts to fit it and never sends a request it can't hold, and a turn that still can't fit
	// ends with `overflowMessage`.
	exactContextWindow?: { overflowMessage: string };
}

export interface GenerateImageRequest {
	prompt: string;
	aspectRatio?: string;
}

export interface GenerateImageResult {
	ok: boolean;
	// A WebP.
	bytes?: Uint8Array;
	error?: string;
	// Rejected by a safety filter; rewriting the prompt may get it through.
	filtered?: boolean;
}

// What a push sends: the site's WordPress archive (a readable stream of the file), or a
// static export of its pages, each file read when the provider uploads it.
export type PushContent =
	| { kind: 'archive'; file: { pipe: unknown }; name: string; size: number }
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
	phase:
		| 'uploading'
		// Another import is running on the remote site, which takes one at a time.
		| 'waitingForRemote'
		| 'creatingRemoteBackup'
		| 'applyingChanges'
		| 'finishing'
		| 'launching';
	progress?: number;
}

export type SiteVisibility = 'public' | 'coming-soon' | 'private';
export type SiteCreationVisibility = Extract< SiteVisibility, 'public' | 'private' >;
// A site to create on a provider. `input` is what the provider's `NewSiteRows` chose.
export interface NewSite {
	name: string;
	visibility?: SiteCreationVisibility;
	input?: Record< string, string >;
}
export interface SiteVisibilityDetails {
	visibility: SiteVisibility | 'unknown';
	availableValues?: SiteVisibility[];
	message?: string;
	url: string;
	launchStatus?: string;
}
// What Studio reads of any provider's remote site.
export interface RemoteSite {
	visibility?: SiteVisibility;
	launchStatus?: string;
	id: string | number;
	name: string;
	url: string;
}

// A temporary site a provider built from a local site.
export interface PreviewSite extends RemoteSite {
	// The link that opens it for anyone, once the provider made one.
	shareUrl?: string;
	// When the provider takes it down, in milliseconds since the epoch.
	expiresAt?: number;
	// The connected site it shows changes to, as the provider confirmed it.
	liveSiteId?: RemoteSite[ 'id' ];
	// Where the owner makes it a site they keep.
	launchUrl?: string;
	// The title it was made with, when the provider reports one.
	title?: string;
	// The `PreviewOptions.originId` it was made with, which the provider reports only to this app.
	originId?: string;
}

// What the provider sends with each build of a preview.
export interface PreviewOptions {
	// The local site it is built from.
	originId?: string;
	// A connected site it shows changes to.
	liveSiteId?: RemoteSite[ 'id' ];
}

// A site to connect: by its id, or by the values of the provider's `sites.connect` form.
export type ResolveFrom = { id: string } | { input: Record< string, string > };

// Sends local sites to a provider's sites and brings them back. The provider
// owns the remote side; Studio builds the content and applies what it pulls.
export interface SitesServices< Config, Site extends RemoteSite > {
	visibility?: {
		get( config: Config | undefined, id: Site[ 'id' ] ): Promise< SiteVisibilityDetails >;
		set(
			config: Config | undefined,
			id: Site[ 'id' ],
			value: SiteVisibility
		): Promise< SiteVisibilityDetails >;
	};
	// The sites the account can sync with. A deleted site stays in the list
	// while it is connected (`connectedIds`).
	list(
		config: Config | undefined,
		options?: { connectedIds?: Site[ 'id' ][]; planRequired?: boolean }
	): Promise< Site[] >;
	// The site with that id, as `--remote-site` names it, or the one the user described in the
	// descriptor's `connect` form, once the provider reached it.
	resolve?( config: Config | undefined, from: ResolveFrom ): Promise< Site >;
	// What the provider's connect form (`@studio/providers/ui`) asks of the computer, by name, such
	// as the hosts of the user's SSH config.
	action?(
		config: Config | undefined,
		name: string,
		input: Record< string, string >
	): Promise< unknown >;
	// A new site to push to, for a provider that can create one.
	create?( config: Config | undefined, site: NewSite ): Promise< Site >;
	creationVisibility?(
		config: Config | undefined,
		input?: NewSite[ 'input' ]
	): Promise< SiteCreationVisibility >;
	// A launch error means the import succeeded; callers keep the publish intent
	// for a retry and must not show the site as published yet. A push to one of
	// `previews.list`'s sites passes `preview`, and rebuilds the preview from the content.
	push(
		config: Config | undefined,
		// The connected site as Studio stored it; a preview update knows only its id.
		site: Pick< Site, 'id' | 'name' > & Partial< Site >,
		content: PushContent,
		options: PushSyncOptions & { preview?: PreviewOptions },
		onStatus: ( status: PushStatus ) => void,
		signal?: AbortSignal
	): Promise< void | { launchError: string } >;
	previews?: {
		// Builds a new preview from the content, and resolves once it can be opened.
		create(
			config: Config | undefined,
			content: PushContent,
			options: PreviewOptions & { name: string },
			onStatus: ( status: PushStatus ) => void,
			signal?: AbortSignal
		): Promise< PreviewSite >;
		// The account's previews the provider still has up: not bought, expired or deleted.
		list( config: Config | undefined ): Promise< PreviewSite[] >;
		// Takes the preview down; one already gone counts as deleted.
		delete( config: Config | undefined, preview: Pick< PreviewSite, 'id' > ): Promise< void >;
	};
	// When the site's content was last edited on the provider, in milliseconds since the epoch.
	editedAt?( config: Config | undefined, site: Pick< Site, 'id' > ): Promise< number >;
	// Writes the site to `archive` as a tar of Studio's backup format (`sql/`, `wp-content/`): the
	// pull of a provider that sends the site itself. `onProgress` gets its percentage.
	pullArchive?(
		config: Config | undefined,
		site: Site,
		options: PullSyncOptions,
		archive: WritableStream< Uint8Array >,
		onProgress: ( percent: number ) => void,
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
	};
}

// Connects and keeps up a provider's account.
export interface AccountServices< Config > {
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
}

// What a provider does, for the hosts that run operations: from `getProviderServices`.
export interface ProviderServices< Config = unknown, Site extends RemoteSite = RemoteSite > {
	id: ProviderId;
	ai?: {
		model(
			config: Config | undefined,
			model: AiModelId,
			// `thinking` is the level the chat picked; without it, the provider's default.
			options: { sessionId?: string; thinking?: ThinkingLevel }
		): Promise< AiConnection >;
		// The catalog of a provider that has one (`Provider.ai.catalog`).
		listModels?( config: Config | undefined ): Promise< CatalogModel[] >;
		// The config that offers these models of the catalog, as `listModels` returned them.
		selectModels?( config: Config, models: CatalogModel[] ): Config | Promise< Config >;
		// Results keep the requests' order; a failure never aborts the rest.
		generateImages?(
			config: Config | undefined,
			requests: GenerateImageRequest[],
			onResult?: ( index: number, result: GenerateImageResult ) => void
		): Promise< GenerateImageResult[] >;
	};
	sites?: SitesServices< Config, Site >;
	account?: AccountServices< Config >;
}
