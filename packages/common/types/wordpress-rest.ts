export interface SiteRestRequest {
	// Path within the site's REST API, resolved against `/wp-json/`.
	path: string;
}

export interface SiteRestResponse {
	status: number;
	statusText: string;
	headers: Record< string, string >;
	body: string;
	url: string;
}
