export interface GithubRelease {
	tag_name: string;
	assets?: {
		name: string;
		browser_download_url: string;
	}[];
}

export async function getLatestSQLiteCommandRelease(): Promise< GithubRelease > {
	const url = 'https://api.github.com/repos/automattic/wp-cli-sqlite-command/releases/latest';
	console.log( '[sqlite-command] Fetching from:', url );

	const headers: HeadersInit = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'wp-now-cli',
	};

	if ( process.env.GITHUB_TOKEN ) {
		console.log( '[sqlite-command] GITHUB_TOKEN available' );
		headers.Authorization = `token ${ process.env.GITHUB_TOKEN }`;
	}

	const response = await fetch( url, { headers } );
	console.log( '[sqlite-command] Response status:', response.status );

	if ( ! response.ok ) {
		const text = await response.text();
		console.log( '[sqlite-command] Error response:', text );
		throw new Error( `GitHub API request failed: ${ response.status } ${ response.statusText }` );
	}

	const data = await response.json();
	console.log( '[sqlite-command] Release data:', {
		tag_name: data.tag_name,
		assets: data.assets?.length,
		download_url: data.assets?.[ 0 ]?.browser_download_url,
	} );

	return data;
}
