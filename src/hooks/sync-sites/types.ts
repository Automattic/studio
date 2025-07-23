export interface LatestRewindIdResponse {
	body: {
		ok: boolean;
		error: string;
		rewind_id: string;
	};
	status: number;
	headers: {
		Allow: string;
	};
}

export interface BackupLsItem {
	type: 'file' | 'dir';
	has_children: boolean;
	period?: string;
	id: string;
	total_items?: number;
	manifest_path?: string;
}

export interface BackupLsResponse {
	body: {
		ok: boolean;
		error: string;
		contents: Record< string, BackupLsItem >;
	};
	status: number;
	headers: {
		Allow: string;
	};
}

export interface BackupLsRequest {
	backup_id: string;
	path: string;
}
