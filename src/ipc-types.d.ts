interface StoppedSiteDetails {
	running: false;

	id: string;
	name: string;
	path: string;
}

interface StartedSiteDetails extends StoppedSiteDetails {
	running: true;

	port: number;
	url: string;
}

type SiteDetails = StartedSiteDetails | StoppedSiteDetails;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tail< T extends any[] > = ( ( ...args: T ) => any ) extends ( _: any, ...tail: infer U ) => any
	? U
	: never;

// IpcApi functions have the same signatures as the functions in ipc-handlers.ts, except
// with the first parameter removed.
type IpcApi = {
	[ K in keyof typeof import('./ipc-handlers') ]: (
		...args: Tail< Parameters< ( typeof import('./ipc-handlers') )[ K ] > >
	) => ReturnType< ( typeof import('./ipc-handlers') )[ K ] >;
};

interface AppGlobals {
	platform: NodeJS.Platform;
}
