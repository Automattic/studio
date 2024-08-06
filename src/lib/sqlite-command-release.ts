export interface GithubRelease {
	tag_name: string;
	assets?: {
		name: string;
		browser_download_url: string;
	}[];
}

export async function getLatestSQLiteCommandRelease(): Promise< GithubRelease > {
	const response = await fetch(
		`https://api.github.com/repos/automattic/wp-cli-sqlite-command/releases/latest`
	);
	return ( await response.json() ) as GithubRelease;
}
