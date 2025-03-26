import { SiteServer } from 'src/site-server';

// Search the database for the old site URL and replace it with the new one
export const updateSiteUrl = async ( server: SiteServer, newUrl: string ) => {
	const { stdout: currentSiteUrl } = await server.executeWpCliCommand( `option get siteurl`, {
		skipPluginsAndThemes: true,
	} );

	if ( ! currentSiteUrl ) {
		console.error( 'Failed to fetch site URL' );
		return;
	}

	const oldUrl = currentSiteUrl.trim();
	if ( newUrl === oldUrl ) {
		return;
	}
	const urlWithoutProtocol = oldUrl.replace( /^https?:\/\//, '' );

	const oldUrlVariants = [
		`http://${ urlWithoutProtocol }`,
		`https://${ urlWithoutProtocol }`,
		// e.g. "posterUrl" for videos uses encoded URLs
		`http%3A%2F%2F${ urlWithoutProtocol }`,
		`https%3A%2F%2F${ urlWithoutProtocol }`,
		// e.g. Elementor plugin uses escaped URLs
		String.raw`http:\/\/${ urlWithoutProtocol }`,
		String.raw`https:\/\/${ urlWithoutProtocol }`,
	];

	for ( const urlToReplace of oldUrlVariants ) {
		const { stderr, exitCode } = await server.executeWpCliCommand(
			`search-replace '${ urlToReplace }' '${ newUrl }' --skip-columns=guid`,
			{ skipPluginsAndThemes: true }
		);

		if ( stderr ) {
			console.error( `Warning during replacing URLs (${ urlToReplace }): ${ stderr }` );
		}

		if ( exitCode ) {
			console.error( `Error during replacing URLs (${ urlToReplace }), Exit Code: ${ exitCode }` );
		}
	}
};
