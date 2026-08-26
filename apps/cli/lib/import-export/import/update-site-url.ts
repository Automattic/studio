import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { SiteData } from 'cli/lib/cli-config/core';

// Search the database for the old site URL and replace it with the new one
export const updateSiteUrl = async ( site: SiteData ) => {
	const newUrl = getSiteUrl( site );

	await using command = await runWpCliCommand(
		site,
		[ 'option', 'get', 'siteurl', '--skip-plugins', '--skip-themes' ],
		{ phpVersion: DEFAULT_PHP_VERSION }
	);

	const currentSiteUrl = await command.response.stdoutText;

	if ( ! currentSiteUrl ) {
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
		await using command = await runWpCliCommand(
			site,
			[
				'search-replace',
				urlToReplace,
				newUrl,
				'--skip-columns=guid',
				'--skip-plugins',
				'--skip-themes',
			],
			{ phpVersion: DEFAULT_PHP_VERSION }
		);

		const stderr = await command.response.stderrText;
		const exitCode = await command.response.exitCode;

		if ( stderr ) {
			console.error( `Warning during replacing URLs (${ urlToReplace }): ${ stderr }` );
		}

		if ( exitCode ) {
			console.error( `Error during replacing URLs (${ urlToReplace }), Exit Code: ${ exitCode }` );
		}
	}
};
