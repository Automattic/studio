/**
 * The contract between Studio and a provider. A provider's folder declares its descriptor, what
 * surfaces show, with `defineProvider`, and its services, what hosts run, with `defineServices`.
 * Each value below says what it means, what a provider supplies or acts on, and what Studio does
 * with it. A value marked as WordPress.com's works for WordPress.com only, and says what any other
 * provider does with it.
 */
import type { AiModelId } from './models';
import type { ProviderId } from './registry';
import type { PullSyncOptions, PushSyncOptions } from './wpcom/sites/site';
import type { Model } from '@earendil-works/pi-ai';
import type { z } from 'zod';

/**
 * The APIs Studio's agent runs a model connection over. A provider's `AiConnection.model.api` is
 * one of them; typecheck rejects any other API, and the agent ends a turn whose connection names
 * one it doesn't run without sending a request.
 */
export const AI_APIS = [
	'openai-completions',
	'openai-responses',
	'anthropic-messages',
	'google-generative-ai',
] as const;

export type AiApi = ( typeof AI_APIS )[ number ];

/** One model a provider offers for chats. The provider lists them in `ai.models`. */
export interface AiModel< Id extends string = string > {
	/**
	 * The model's id. Studio stores it in each chat's history, so it never changes. The same id in
	 * two providers is the same model: surfaces show the first registered provider's label, image
	 * support and paid-credit rule for it, and a provider that resells a model another provider
	 * lists uses that provider's id.
	 */
	id: Id;
	/** The model's name in the model pickers. Supplied by the provider; brand names stay untranslated. */
	label: () => string;
	/**
	 * Whether the model reads images. Defaults to true. A provider sets false on text-only models:
	 * the agent then never sends them images, such as screenshots in tool results.
	 */
	supportsImages?: boolean;
	/**
	 * WordPress.com's: the pickers lock the model unless the WordPress.com account has paid AI
	 * credits left. Any other provider leaves it out, since its account pays for its own models.
	 */
	requiresPaidAiCredits?: boolean;
}

/**
 * The fields a `form` connect method asks for: a flat zod object of strings. Each field's metadata
 * (`.meta()`) gives its `title`, `description` and `examples`, the first of which surfaces show
 * as a placeholder, and `writeOnly: true` marks a secret, which surfaces never show back. The
 * settings render a form from it and `studio code` prompts for each field; the field's own
 * checks run before the provider's `connect` receives the values.
 */
export type ConnectInputSchema = z.ZodObject< Record< string, z.ZodType< string > > >;

/**
 * One way a provider's account connects, which the user picks by its label. Studio hands the
 * provider's `account.connect` the method's `id` with what the user gave, or what came back from
 * the provider's site.
 */
export type ConnectMethod = {
	/** The method's id. Configs and account details record it, so it never changes. */
	id: string;
	/** What the user picks to connect this way, such as "API key". */
	label: () => string;
	/** What to do before connecting, in Markdown: the settings render it, `studio code` prints it. */
	instructions?: () => string;
} & (
	| {
			/**
			 * A form, rendered from `input`, whose values `account.connect` receives. The Desktop
			 * app, `studio ui`, `studio code` and Studio on the web all offer it.
			 */
			kind: 'form';
			/** The form's fields. */
			input: () => ConnectInputSchema;
	  }
	| {
			/**
			 * The Studio sign-in, WordPress.com's only: approving access on WordPress.com, which
			 * redirects back to each app its own way. `defineProvider` rejects it for any other
			 * provider.
			 */
			kind: 'redirect';
	  }
	| {
			/**
			 * Signing in on the provider's site, which redirects back to an address on this
			 * computer where Studio listens. `account.start` receives the address. The Desktop app,
			 * `studio ui` and `studio code` offer it; Studio on the web doesn't.
			 */
			kind: 'loopback';
	  }
	| {
			/**
			 * Approving a code on the provider's site while Studio waits: `account.start` returns
			 * the code, and `account.connect` resolves once the user approves it. The Desktop app,
			 * `studio ui` and `studio code` offer it; Studio on the web doesn't.
			 */
			kind: 'device';
	  }
);

// The methods a provider declares: the Studio sign-in is WordPress.com's, so typecheck rejects a
// `redirect` method in any other provider's descriptor.
type ProviderConnectMethod< Id extends string > = [ 'wpcom' ] extends [ Id ]
	? ConnectMethod
	:
			| Exclude< ConnectMethod, { kind: 'redirect' } >
			| ( Omit< Extract< ConnectMethod, { kind: 'redirect' } >, 'kind' > & {
					kind: 'redirect' & {
						'redirect is the Studio sign-in, which only WordPress.com declares': never;
					};
			  } );

/** What surfaces show of a connected account, from `account.describe`; never the credential. */
export interface AccountDetails< ModelId extends string = AiModelId > {
	/** The id of the method the account connected with. */
	method: string;
	/** Who or what is connected, such as an email or the start of a key. Shown next to the provider. */
	summary?: string;
	/** Something to know when using the account, such as whose plan pays for it. */
	note?: string;
	/**
	 * The provider's models this account can run, when its plan decides which. The pickers then
	 * offer only these; without it, they offer every model the provider lists.
	 */
	models?: ModelId[];
	/** Pages about the account, such as where to manage its usage. Shown with the account. */
	links?: { label: string; url: string }[];
}

/**
 * A connection `account.start` began on the provider's site. Surfaces send the user to `url` and
 * show `code` to approve when there is one; then Studio hands `handoff` back to `account.connect`.
 */
export interface PendingConnect {
	/** Where the user signs in or approves the code. */
	url: string;
	/** The code the user approves there, for a `device` method. */
	code?: string;
	/**
	 * What `account.connect` needs to finish connecting, in the provider's own keys and values.
	 * Studio keeps it, never shows it, and hands it back to `connect` as it is.
	 */
	handoff: Record< string, string >;
}

/** What `account.start` begins from. Studio builds it for each sign-in. */
export interface ConnectContext {
	/** Where a `loopback` sign-in redirects back to: an address on this computer Studio listens on. */
	redirectUri?: string;
	/** An id that stays the same on this computer, for providers that register each computer. */
	hostId: string;
	/**
	 * What `account.remember` kept from the current config, or from the last one the provider
	 * rejected, so signing in again continues the same registration.
	 */
	remembered?: Record< string, string >;
}

/** What Studio reads of any provider's remote site. A provider's own site type extends it. */
export interface RemoteSite {
	/** The site's id on the provider. Studio stores it with the local site the site is connected to. */
	id: string | number;
	/** The site's name, shown in the publish panel and in `studio push`. */
	name: string;
	/** The site's address, which `studio push --remote-site` also accepts. */
	url: string;
}

/** How surfaces present a provider's remote sites, so the publish panel names no provider. */
export interface ProviderSitesInfo< Site extends RemoteSite = RemoteSite > {
	/** The largest archive a push sends, in bytes. Studio refuses a larger push before sending it. */
	maxPushSize?: number;
	/**
	 * Whether Studio pulls a site back. Only WordPress.com pulls: any other provider sets false,
	 * and Studio only publishes to it.
	 */
	pull: boolean;
	/**
	 * Whether a push or pull can include only part of the site. With false, a push always sends
	 * the whole site; with true, the user picks what to send.
	 */
	selective: boolean;
	/**
	 * What a push sends: the site's WordPress archive, or a static export of its pages. Studio
	 * builds it; a static export needs the site to run on native PHP.
	 */
	content: 'archive' | 'static';
	/**
	 * How the publish panel makes a new site: `create` calls `sites.create` right away;
	 * `checkout` is WordPress.com's checkout, which connects the site to the local one afterwards.
	 * Any other provider uses `create`.
	 */
	newSite: 'checkout' | 'create';
	/** What the publish panel says before a site is connected. */
	intro: { title: () => string; description: () => string; learnMoreUrl: string };
	/** Facts about a connected site, and links to manage it on the provider, for the publish panel. */
	describe( site: Site ): {
		details: { title: string; value: string }[];
		links: { title: string; url: string }[];
	};
	/**
	 * Why the site can't be published to or pulled from now, which the publish panel shows instead
	 * of the action, or null when it can.
	 */
	issue( site: Site, direction: 'push' | 'pull' ): string | null;
	/** Something to know before pushing the local site, which surfaces show without blocking it. */
	pushWarning?( site: Site, local: { multisite?: boolean } ): string | null;
	/**
	 * WordPress.com's: whether the site keeps backups a selective pull can browse. Any other
	 * provider leaves it out.
	 */
	hasBackups?( site: Site ): boolean;
	/**
	 * Fills the local site's stored connections in from the account's current sites, so the
	 * publish panel shows a renamed site's new name. Keep what is stored for a site gone from the
	 * account: Studio shows it until the user disconnects it.
	 */
	withDetails< Connection extends Site >( connections: Connection[], sites: Site[] ): Connection[];
}

/**
 * A provider as it declares itself: browser-safe data that surfaces read, through `getProvider`,
 * in every app and in the page. A provider's `descriptor.ts` declares it with `defineProvider`.
 */
export interface ProviderDescriptor<
	Id extends string = string,
	Config = unknown,
	ModelId extends string = string,
	Site extends RemoteSite = RemoteSite,
	Methods extends readonly ConnectMethod[] = readonly [
		ProviderConnectMethod< Id >,
		...ProviderConnectMethod< Id >[],
	],
	Sites = unknown,
> {
	/**
	 * The provider's id, which names it in `studio code`'s commands and in `studio push
	 * --remote-site <id>`. Studio stores it with the provider's config, the selected chat
	 * provider, each chat and each connected site, so it never changes.
	 */
	id: Id;
	/** The brand name every surface shows, untranslated. */
	label: string;
	/** One sentence on what connecting the provider offers, shown under its name in Settings. */
	description?: () => string;
	/** Where to read more, or get a key, linked from its row in Settings. */
	learnMoreUrl?: string;
	/** The provider's mark: an SVG document, which may draw in `currentColor`. */
	icon?: string;
	/**
	 * The provider's logo in its brand colors: a square SVG document, background included, that
	 * fills its canvas. Surfaces round it into a tile like an app icon, so it reads the same in
	 * light and dark, and fall back to `icon` without one, or to a generic mark without either.
	 */
	logo?: string;
	account: {
		/**
		 * The provider's config: what Studio stores once the account connects, and hands back to
		 * every service. Studio checks a stored config against it, and treats one that doesn't
		 * parse as not connected.
		 */
		configSchema: z.ZodType< Config >;
		/** The ways the account connects; the first is the default. */
		methods: Methods;
		/** What surfaces show of the connected account. */
		describe( config: Config ): AccountDetails< NoInfer< ModelId > >;
		/**
		 * When the config stops working, in milliseconds since the epoch. Studio treats the
		 * provider as disconnected from then on.
		 */
		expiresAt?( config: Config ): number | undefined;
		/**
		 * What to keep once the provider rejects the config, never a credential. Studio stores it
		 * and hands it to the next sign-in as `ConnectContext.remembered`.
		 */
		remember?( config: Config ): Record< string, string > | undefined;
	};
	/**
	 * Chat models. With it, the provider is an AI provider: Settings list it under AI providers,
	 * its models are in the model pickers, and its services must include `ai`.
	 */
	ai?: {
		/** Every model the provider offers, in the order the pickers show them. */
		models: readonly AiModel< ModelId >[];
		/** The model a chat on the provider starts with. */
		defaultModel: NoInfer< ModelId >;
		/**
		 * WordPress.com's: the default model while the WordPress.com account has paid AI credits
		 * left. Any other provider leaves it out.
		 */
		paidDefaultModel?: NoInfer< ModelId >;
	};
	/**
	 * Remote sites that local sites publish to. With it, the provider is a hosting provider:
	 * Settings list it under Hosting providers, the publish panel offers its sites, `studio push
	 * --remote-site <id>` publishes to them, and its services must include `sites`.
	 */
	sites?: ProviderSitesInfo< Site > & Sites;
}

// A declared descriptor, whose parts the helpers read from its type: `ai` only when it lists
// models, and `sites` only when it has remote sites.
type DeclaredProvider<
	Id extends string,
	Config,
	Methods extends readonly ConnectMethod[],
	ModelId extends string,
	Site extends RemoteSite,
	Pull extends boolean,
	NewSite extends ProviderSitesInfo[ 'newSite' ],
> = Omit< ProviderDescriptor< Id, Config, ModelId, Site, Methods >, 'ai' | 'sites' > &
	( [ ModelId ] extends [ never ]
		? unknown
		: { ai: NonNullable< ProviderDescriptor< Id, Config, ModelId >[ 'ai' ] > } ) &
	( [ Pull ] extends [ never ]
		? unknown
		: { sites: ProviderSitesInfo< Site > & { pull: Pull; newSite: NewSite } } );

/**
 * Declares a provider's descriptor, in its `descriptor.ts`, keeping its literal id, config, model
 * ids, site type and connect methods, which the registration derives Studio's provider types from
 * and `defineServices` checks services against. A provider annotates its site type in the
 * parameter of `sites.describe`.
 */
export function defineProvider<
	const Id extends string,
	Config,
	const Methods extends readonly [ ProviderConnectMethod< Id >, ...ProviderConnectMethod< Id >[] ],
	const ModelId extends string = never,
	Site extends RemoteSite = RemoteSite,
	Pull extends boolean = never,
	NewSite extends ProviderSitesInfo[ 'newSite' ] = never,
>(
	descriptor: ProviderDescriptor<
		Id,
		Config,
		ModelId,
		Site,
		Methods,
		{ pull: Pull; newSite: NewSite }
	>
): DeclaredProvider< Id, Config, Methods, ModelId, Site, Pull, NewSite > {
	return descriptor as DeclaredProvider< Id, Config, Methods, ModelId, Site, Pull, NewSite >;
}

/** The config a declared descriptor stores. */
export type ConfigOf< Descriptor > = Descriptor extends {
	account: { configSchema: z.ZodType< infer Config > };
}
	? Config
	: never;

/** The ids of a declared descriptor's models, or never when it offers none. */
export type ModelIdOf< Descriptor > = Descriptor extends {
	ai: { models: readonly ( infer Model )[] };
}
	? Model extends { id: infer Id extends string }
		? Id
		: never
	: never;

/** A declared descriptor's remote site, or never when it has none. */
export type SiteOf< Descriptor > = Descriptor extends {
	sites: { describe( site: infer Site extends RemoteSite ): unknown };
}
	? Site
	: never;

/**
 * Connects and keeps the provider's account. Studio stores the config `connect` returns, and hands
 * it to every other service.
 */
export interface AccountServices< Config > {
	/**
	 * Starts connecting with a `loopback` or `device` method, which a provider with one of them
	 * must implement: returns where the user goes, and what `connect` takes back.
	 */
	start?( method: string, context: ConnectContext ): Promise< PendingConnect >;
	/**
	 * Checks what the user gave and returns the config to store. `input` is a form's values; for
	 * a sign-in, the `handoff` `start` returned, with a loopback redirect's query parameters; for
	 * WordPress.com, the redirect's parameters. Throws `ConnectError`, whose message surfaces show,
	 * when connecting fails. A provider that can't reach its service to check a credential may
	 * accept it unchecked.
	 */
	connect( method: string, input: Record< string, string > ): Promise< Config >;
	/**
	 * Renews a credential about to expire: returns the config to store, or undefined while it still
	 * works. The Desktop app, `studio ui` and the CLI call it before every use of the config, one
	 * process at a time. Throwing `NotConnectedError` means the provider no longer accepts the
	 * config: they forget it, keeping what `account.remember` says. Studio on the web never calls
	 * it: it uses the stored config as it is, until `account.expiresAt` passes.
	 */
	refresh?( config: Config ): Promise< Config | undefined >;
	/** Cleans up on the provider's side, such as revoking a token, before Studio removes the config. */
	disconnect?( config: Config ): Promise< void >;
}

/**
 * Everything the agent needs to run one model: it registers the model with pi and streams the
 * chat's turns over `model.api`.
 */
export interface AiConnection {
	/**
	 * The provider name pi gives the model. pi adjusts requests for providers it knows by name,
	 * such as `anthropic`, `openai` or `github-copilot`, so a provider sets the name of the service
	 * its requests go to, the same as `model.provider`: its own id for a service pi doesn't know.
	 */
	piProvider: string;
	/** The credential the agent sends, the way the connection's API sends one. */
	apiKey: string;
	/** Headers the agent sends with every request. */
	headers?: Record< string, string >;
	/**
	 * The model as pi describes it. `id` is the Studio model id, which chats record; `name` its
	 * name; `api` one of `AI_APIS`; `provider` the same as `piProvider`; `baseUrl` where requests
	 * go; `reasoning` whether it thinks before answering; `input` `[ 'text' ]`, or `[ 'text',
	 * 'image' ]` when it reads images; `cost` its prices, which Studio doesn't show; and
	 * `contextWindow` and `maxTokens` its limits, in tokens. `compat` adjusts requests to an
	 * OpenAI-compatible service that differs from OpenAI. A model in pi's catalog
	 * (`@earendil-works/pi-ai/providers/*.models`) can start from its entry there.
	 */
	model: Model< AiApi >;
	/** The model id sent on the wire, when the provider's service names the model differently. */
	requestModelId?: string;
	/**
	 * Replaces a failed turn's error message, the user reads, before the agent decides whether to
	 * retry; returning undefined keeps it.
	 */
	rewriteError?: ( message: string ) => string | undefined;
}

/** One image the agent asks for. */
export interface GenerateImageRequest {
	/** What to draw. */
	prompt: string;
	/** The layout slot the image fills, such as `landscape` or `square`. */
	aspectRatio?: string;
}

/** One generated image, or why it failed. */
export interface GenerateImageResult {
	/** Whether the image was generated. */
	ok: boolean;
	/** The image, when `ok`. */
	bytes?: Uint8Array;
	/** Why it failed, for the agent. */
	error?: string;
	/** Rejected by a safety filter: the agent may rewrite the prompt and try again. */
	filtered?: boolean;
}

/** The provider's chat models, and the images it generates. */
export interface AiServices< Config, ModelId extends string = string > {
	/**
	 * The connection to run `model`, one of the provider's model ids, with the stored config.
	 * Throws `NotConnectedError`, whose message the chat shows, when `config` is undefined or no
	 * longer works.
	 */
	model(
		config: Config | undefined,
		model: ModelId,
		options: {
			/** The chat's id, for providers that group a chat's requests. */
			sessionId?: string;
		}
	): Promise< AiConnection >;
	/** Whether `generateImages` works with this config. Defaults to true. */
	canGenerateImages?( config: Config ): boolean;
	/**
	 * Generates images for the agent: when the provider is the chat's, and in the Desktop app,
	 * `studio ui` and `studio code` for a chat whose provider doesn't generate them, when it is the
	 * first connected provider that does. Results keep the requests' order, `onResult` reports each
	 * as it finishes, and one failure never aborts the rest.
	 */
	generateImages?(
		config: Config | undefined,
		requests: GenerateImageRequest[],
		onResult?: ( index: number, result: GenerateImageResult ) => void
	): Promise< GenerateImageResult[] >;
}

/**
 * What a push sends, which Studio builds from `sites.content`.
 *
 * - `archive`: the site's WordPress archive, a `.tar.gz` file named `name`, of `size` bytes. In
 *   the page `file` is a Blob; in Node it is a readable stream of the file, which `fetch` sends
 *   as a request body with `duplex: 'half'` and `size` as its `Content-Length`. A provider that
 *   stops before reading it all destroys it (`file.destroy()`); Studio deletes the file after
 *   the push.
 * - `files`: a static export of the site's pages, each file read when the provider uploads it.
 */
export type PushContent =
	| { kind: 'archive'; file: Blob | { pipe: unknown }; name: string; size: number }
	| { kind: 'files'; files: PushFile[] };

/** One file of a static export. */
export interface PushFile {
	/** Relative to the export's root, with `/` separators. */
	path: string;
	/** In bytes. */
	size: number;
	/** The file's contents. */
	read(): Promise< Uint8Array >;
}

/** A push's step on the provider's side, after Studio built the content. */
export interface PushStatus {
	/**
	 * The step, which surfaces show as the push's progress: uploading the content, backing up the
	 * remote site, applying the changes, finishing, or launching the site, which is WordPress.com's.
	 */
	phase: 'uploading' | 'creatingRemoteBackup' | 'applyingChanges' | 'finishing' | 'launching';
	/** The step's own percentage, when the provider knows it. */
	progress?: number;
}

/**
 * Publishes local sites to the provider's sites, and pulls them back. The provider owns the remote
 * side; Studio builds what it sends, applies what it pulls, and stores which sites a local site is
 * connected to. Every call takes the stored config, or undefined, and throws `NotConnectedError`
 * without a usable one, after which Studio forgets the config.
 */
export interface SitesServices< Config, Site extends RemoteSite = RemoteSite > {
	/**
	 * The sites the account can publish to, which the publish panel and `studio push` offer. A
	 * site deleted on the provider stays in the list while a local site is connected to it.
	 */
	list(
		config: Config | undefined,
		options?: {
			/** The sites local sites are connected to. */
			connectedIds?: Site[ 'id' ][];
			/** WordPress.com's: list only the sites whose plan allows syncing. Any other provider ignores it. */
			planRequired?: boolean;
		}
	): Promise< Site[] >;
	/**
	 * Creates a site to publish to, named after the local site, which Studio then connects to it.
	 * A provider whose `sites.newSite` is `create` implements it.
	 */
	create?( config: Config | undefined, options: { name: string } ): Promise< Site >;
	/**
	 * Publishes `content` to `site`, reporting each step through `onStatus` and stopping when
	 * `signal` aborts. A provider throws `RemoteSiteError`, whose message surfaces show, when a
	 * step fails.
	 *
	 * `options` are WordPress.com sync's selection: `optionsToSync` names what to include (`all`,
	 * or parts such as `sqls`, `plugins` and `themes`), `specificSelectionPaths` the files the
	 * user picked, and `launchAfterPush` is WordPress.com's. A provider whose `sites.selective` is
	 * false always receives the whole site (`optionsToSync: [ 'all' ]`) and ignores them. Resolving with a
	 * `launchError` is WordPress.com's: the import succeeded but launching the site failed, so
	 * Studio keeps the intent to launch for the next push.
	 */
	push(
		config: Config | undefined,
		site: Pick< Site, 'id' | 'name' >,
		content: PushContent,
		options: PushSyncOptions,
		onStatus: ( status: PushStatus ) => void,
		signal?: AbortSignal
	): Promise< void | { launchError: string } >;
	/**
	 * WordPress.com's: pulling a site back, through a remote backup and the site's export API,
	 * which a local Reprint reads. A provider whose `sites.pull` is true implements it; no other
	 * provider pulls today.
	 */
	pull?: {
		/**
		 * Backs the site up remotely and resolves with where to download the archive.
		 * `onProgress` gets the backup's percentage.
		 */
		backup(
			config: Config | undefined,
			site: Pick< Site, 'id' >,
			options: PullSyncOptions,
			onProgress: ( percent: number ) => void,
			signal?: AbortSignal
		): Promise< { url: string; size: number } >;
		/**
		 * The site's export API, which a local Reprint reads the site through. Opening it also
		 * reports whether the site has Studio's key.
		 */
		openExporter(
			config: Config | undefined,
			site: Pick< Site, 'id' | 'url' >
		): Promise< { apiUrl: string; hasKey: boolean } >;
		/** Installs Studio's key on the site, so a local Reprint can read it. */
		installExporterKey(
			config: Config | undefined,
			site: Pick< Site, 'id' >,
			publicKey: string
		): Promise< void >;
		/** The latest backup's id, for a selective pull. */
		latestBackupId( config: Config | undefined, site: Pick< Site, 'id' > ): Promise< string >;
		/** The raw entries of one folder of a backup, which a selective pull lists. */
		listBackupFiles(
			config: Config | undefined,
			site: Pick< Site, 'id' >,
			backupId: string,
			path: string
		): Promise< Record< string, unknown > >;
	};
}

type SignInKind = 'loopback' | 'device';

type SitesServicesOf< Config, Site extends RemoteSite, Sites > = Omit<
	SitesServices< Config, Site >,
	'create' | 'pull'
> &
	( Sites extends { newSite: 'checkout' }
		? unknown
		: Required< Pick< SitesServices< Config, Site >, 'create' > > ) &
	( Sites extends { pull: false }
		? unknown
		: Required< Pick< SitesServices< Config, Site >, 'pull' > > );

/**
 * The services a declared descriptor needs: `account`, with `start` when a connect method is a
 * `loopback` or `device` sign-in; `ai` when it offers models; and `sites` when it has remote
 * sites, with `create` when `sites.newSite` is `create` and `pull` when `sites.pull` is true.
 * Nothing for a capability it doesn't declare.
 */
export type ServicesOf< Descriptor extends { id: string } > = {
	account: AccountServices< ConfigOf< Descriptor > > &
		( Descriptor extends { account: { methods: readonly ( infer Method )[] } }
			? [ Extract< Method, { kind: SignInKind } > ] extends [ never ]
				? unknown
				: Required< Pick< AccountServices< ConfigOf< Descriptor > >, 'start' > >
			: unknown );
} & ( Descriptor extends { ai: object }
	? { ai: AiServices< ConfigOf< Descriptor >, ModelIdOf< Descriptor > > }
	: unknown ) &
	( Descriptor extends { sites: infer Sites }
		? { sites: SitesServicesOf< ConfigOf< Descriptor >, SiteOf< Descriptor >, Sites > }
		: unknown );

/**
 * Declares a provider's services, in its `services.ts`, against the folder's own descriptor, which
 * decides the parts they need (`ServicesOf`). The services entry reads them from the module's
 * `services` export: `export const services = defineServices( descriptor, { … } )`.
 */
export function defineServices< Descriptor extends { id: string } >(
	descriptor: Descriptor,
	services: ServicesOf< Descriptor >
): ServicesOf< Descriptor > & { id: Descriptor[ 'id' ] } {
	return { ...services, id: descriptor.id };
}

/**
 * A registered provider as surfaces read it, from `getProvider`: its descriptor, typed for any
 * provider.
 */
export type Provider< Config = unknown, Site extends RemoteSite = RemoteSite > = ProviderDescriptor<
	ProviderId,
	Config,
	AiModelId,
	Site
>;

/** What a registered provider does, for the hosts that run it: from `getProviderServices`. */
export interface ProviderServices< Config = unknown, Site extends RemoteSite = RemoteSite > {
	id: ProviderId;
	account: AccountServices< Config >;
	ai?: AiServices< Config, AiModelId >;
	sites?: SitesServices< Config, Site >;
}
