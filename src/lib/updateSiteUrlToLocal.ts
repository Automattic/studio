import { SiteServer } from 'src/site-server';

export const updateSiteUrlToLocal = async ( siteId: string ) => {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	const { stdout: currentSiteUrl } = await server.executeWpCliCommand( `option get siteurl`, {
		skipPluginsAndThemes: true,
	} );

	if ( ! currentSiteUrl ) {
		console.error( 'Failed to fetch site URL after import' );
		return;
	}

	const studioUrl = `http://localhost:${ server.details.port }`;
	const oldUrl = currentSiteUrl.trim();
	const urlWithoutProtocol = oldUrl.replace( /^https?:\/\//, '' );

	const oldUrlVariants = [ `http://${ urlWithoutProtocol }`, `https://${ urlWithoutProtocol }` ];

	for ( const urlToReplace of oldUrlVariants ) {
		const { stderr, exitCode } = await server.executeWpCliCommand(
			`search-replace '${ urlToReplace }' '${ studioUrl }' --skip-columns=guid`,
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
