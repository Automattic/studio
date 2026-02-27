interface GithubRelease {
	tag_name: string;
	assets?: {
		name: string;
		browser_download_url: string;
	}[];
}

export async function getLatestSQLiteCommandRelease(): Promise< GithubRelease > {
	const url = 'https://api.github.com/repos/automattic/wp-cli-sqlite-command/releases/latest';

	const headers: HeadersInit = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'wp-now-cli',
	};

	// GitHub API has rate limits:
	// - 60 requests/hour for unauthenticated requests
	// - 5,000 requests/hour with token authentication
	// In CI environments, the IP-based rate limit is shared across runners,
	// so we authenticate with GITHUB_TOKEN when available.
	if ( process.env.GITHUB_TOKEN ) {
		headers.Authorization = `token ${ process.env.GITHUB_TOKEN }`;
	}

	const response = await fetch( url, { headers } );

	if ( ! response.ok ) {
		throw new Error( `GitHub API request failed: ${ response.status } ${ response.statusText }` );
	}

	return await response.json();
}
