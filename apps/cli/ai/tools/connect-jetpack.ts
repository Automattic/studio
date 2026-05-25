import { readAuthToken } from '@studio/common/lib/shared-config';
import { Type } from 'typebox';
import { getUserInfo } from 'cli/lib/api';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

// Calls Manager::register() which makes an outbound call to jetpack.wordpress.com,
// stores the blog_id and blog_token, and makes is_connection_ready() return true.
const REGISTER_PHP =
	'$m = new \\Automattic\\Jetpack\\Connection\\Manager("jetpack");' +
	'$r = $m->register();' +
	'if(is_wp_error($r)){fwrite(STDERR,$r->get_error_message());exit(1);}' +
	'echo \\Jetpack_Options::get_option("id");';

export const connectJetpackTool = defineTool(
	'connect_jetpack',
	'Connects Jetpack to WordPress.com on a local site, enabling wpcom-dependent features (subscriptions, stats, sharing, etc.). Requires the user to be logged in to WordPress.com. Installs Jetpack if not already present.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or file system path to connect',
		} ),
	},
	async ( args ) => {
		const authToken = await readAuthToken();
		if ( ! authToken?.accessToken ) {
			throw new Error(
				'Not logged in to WordPress.com. Run `studio auth login` first, then retry.'
			);
		}

		const site = await resolveSite( args.nameOrPath );

		try {
			await connectToDaemon();

			if ( ! ( await isServerRunning( site.id ) ) ) {
				throw new Error( `Site "${ site.name }" is not running. Start it first using site_start.` );
			}

			// Install and activate Jetpack if not present.
			await sendWpCliCommand( site.id, [ 'plugin', 'install', 'jetpack', '--activate' ] );

			// Register the site with WordPress.com (outbound call → blog_id + blog_token).
			const registerResult = await sendWpCliCommand( site.id, [
				'--user=1',
				'eval',
				REGISTER_PHP,
			] );

			if ( registerResult.exitCode !== 0 ) {
				throw new Error(
					`Jetpack registration failed: ${ registerResult.stderr?.trim() || 'unknown error' }`
				);
			}

			const blogId = registerResult.stdout?.trim();

			// Authorize the current user so modules that require a user connection
			// (e.g. subscriptions) can also activate.
			// wp jetpack authorize_user stores "{token}.{wp_user_id}" as the user token.
			await sendWpCliCommand( site.id, [
				'--user=1',
				'jetpack',
				'authorize_user',
				`--token=${ authToken.accessToken }`,
			] );

			let username = 'WordPress.com';
			try {
				const userInfo = await getUserInfo( authToken.accessToken );
				username = userInfo.username;
			} catch {
				// Non-fatal: username is cosmetic only.
			}

			return textResult(
				`Jetpack connected to WordPress.com (blog ID ${ blogId }) as ${ username }.` +
					` Connection-dependent modules (subscriptions, stats, sharing) can now be activated.`
			);
		} finally {
			await disconnectFromDaemon();
		}
	}
);
