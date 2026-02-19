// Defined in electron.vite.config.ts
declare const COMMIT_HASH: string | undefined;

interface ShowNotificationOptions extends Electron.NotificationConstructorOptions {
	showIcon: boolean;
}

interface StoppedSiteDetails {
	running: false;

	id: string;
	name: string;
	path: string;
	port: number;
	phpVersion: string;
	isWpAutoUpdating?: boolean;
	customDomain?: string;
	enableHttps?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	tlsKey?: string;
	tlsCert?: string;
	themeDetails?: {
		name: string;
		path: string;
		slug: string;
		isBlockTheme: boolean;
		supportsWidgets: boolean;
		supportsMenus: boolean;
	};
	isAddingSite?: boolean;
	autoStart?: boolean;
	latestCliPid?: number;
	enableXdebug?: boolean;
}

interface StartedSiteDetails extends StoppedSiteDetails {
	running: true;

	url: string;
}

type SiteDetails = StartedSiteDetails | StoppedSiteDetails;

type InstalledApps = {
	antigravity: boolean;
	vscode: boolean;
	phpstorm: boolean;
	webstorm: boolean;
	windsurf: boolean;
	cursor: boolean;
	sublime: boolean;
	zed: boolean;
	terminal: boolean;
	iterm: boolean;
	warp: boolean;
	ghostty: boolean;
};

type WithoutIpcEvent< T extends unknown[] > = T extends [ unknown, ...infer Rest ] ? Rest : [];
type ToPromise< T > = T extends Promise< unknown > ? T : Promise< T >;
type IpcHandlers = typeof import('./ipc-handlers');

// Define which handlers use `ipcRenderer.send` instead of `ipcRenderer.invoke` in `src/preload.ts`
type IpcVoidHandlers = ( typeof import('./constants') )[ 'IPC_VOID_HANDLERS' ][ number ];

// IpcApi functions have the same signatures as the functions in ipc-handlers.ts, except
// with the first parameter removed.
type IpcApi = {
	// `void` is satisfied by `Promise<any>`, which means that if a method in the
	// `IpcVoidHandlers` list returns an `ipcRenderer.invoke` call, it wouldn't raise a type
	// error. We use `undefined` instead because we need to be intentional about using
	// `ipcRenderer.invoke` vs `ipcRenderer.send`. We make this work in `preload.ts` with the help
	// of a utility function.
	[ K in keyof IpcHandlers ]: (
		...args: WithoutIpcEvent< Parameters< IpcHandlers[ K ] > >
	) => K extends IpcVoidHandlers ? undefined : ToPromise< ReturnType< IpcHandlers[ K ] > >;
} & {
	// `webUtils.getPathForFile` is available only inside preload script, that's why this one
	// function is exception and need to be defined here manually. See
	// https://www.electronjs.org/docs/latest/breaking-changes#planned-breaking-api-changes-320
	getPathForFile: ( file: File ) => string;
};

interface FeatureFlags {
	enableBlueprints: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BetaFeatures {}

interface AppGlobals extends FeatureFlags {
	platform: NodeJS.Platform;
	appName: string;
	appVersion: string;
	arm64Translation: boolean;
	isWindowsStore: boolean;
}

// Our IPC objects will be attached to the `window` global
interface Window {
	ipcApi: IpcApi;
	appGlobals: AppGlobals;
}

// Network
interface WpcomNetworkError extends Error {
	code: string;
	status: number;
}
