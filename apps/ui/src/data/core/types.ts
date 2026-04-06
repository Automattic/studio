export interface SiteDetails {
	id: string;
	name: string;
	path: string;
	port: number;
	running: boolean;
	url?: string;
	phpVersion: string;
	themeDetails?: {
		name: string;
		path: string;
		slug: string;
		isBlockTheme: boolean;
	};
}

export interface AuthUser {
	id: number;
	email: string;
	displayName: string;
}

export interface Connector {
	// Auth
	requiresAuth: boolean;
	isAuthenticated(): Promise< boolean >;
	getAuthUser(): Promise< AuthUser | null >;
	authenticate(): Promise< void >;
	logout(): Promise< void >;

	// Sites
	getSites(): Promise< SiteDetails[] >;
	createSite( params: { name: string } ): Promise< SiteDetails >;
	deleteSite( id: string ): Promise< void >;
	startSite( id: string ): Promise< void >;
	stopSite( id: string ): Promise< void >;
}
