export async function getLatestSQLiteDatabaseIntegrationRelease(): Promise< string > {
	const response = await fetch(
		'https://api.github.com/repos/automattic/sqlite-database-integration/releases/latest'
	);
	const data = await response.json();
	return `https://github.com/Automattic/sqlite-database-integration/archive/refs/tags/${ data.tag_name }.zip`;
}
