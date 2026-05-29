export interface SiteRestRequest {
	path?: string;
	url?: string;
	method?: string;
	headers?: Record< string, string >;
	body?: string | ArrayBuffer;
	data?: unknown;
	parse?: boolean;
}

export interface SiteRestResponse {
	status: number;
	statusText: string;
	headers: Record< string, string >;
	body: string;
	url: string;
}
