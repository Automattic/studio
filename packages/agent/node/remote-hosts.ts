import type { HostSite, ProgressCallback } from './host';
import type { SiteInfo } from './types';

export interface RemoteSite {
	host: string;
	id: string | number;
}

export interface HostSiteListing {
	signedIn: boolean;
	sites: Array< { id: string | number; name: string; url: string } >;
	error?: string;
}

// Targets are already shaped for the host's connected-sites tool output.
export interface RemoteHost {
	name: string;
	sites?: {
		listKey: string;
		list(): Promise< HostSiteListing >;
	};
	targets( site: { id: string; path: string } ): Promise< Record< string, unknown >[] >;
	push(
		site: HostSite,
		target: string,
		options: string,
		onProgress: ProgressCallback
	): Promise< string >;
	pull?(
		site: HostSite,
		target: string,
		options: string,
		onProgress: ProgressCallback
	): Promise< string >;
	describeSite( site: SiteInfo ): string;
}
