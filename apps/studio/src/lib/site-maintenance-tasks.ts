import { backgroundTasks } from 'src/lib/background-tasks';
import { SiteServer } from 'src/site-server';

const REFRESH_LOCAL_ADMIN_CHECKS_CODE = `
require_once ABSPATH . 'wp-admin/includes/update.php';
require_once ABSPATH . 'wp-admin/includes/dashboard.php';
require_once ABSPATH . 'wp-admin/includes/misc.php';
require_once ABSPATH . 'wp-admin/includes/translation-install.php';

wp_version_check();
wp_update_plugins();
wp_update_themes();
wp_check_browser_version();
wp_check_php_version();
wp_get_available_translations();
`;

export function scheduleLocalAdminChecksRefresh(
	server: SiteServer,
	trigger: string = 'site-start'
): Promise< void > {
	return backgroundTasks.enqueue( {
		name: 'refresh-local-admin-checks',
		scope: `site:${ server.details.id }`,
		trigger,
		delayMs: 1000,
		requiresRunning: () => server.details.running,
		run: async () => {
			const result = await server.executeWpCliCommand( [
				'eval',
				REFRESH_LOCAL_ADMIN_CHECKS_CODE,
			] );

			if ( result.exitCode !== 0 ) {
				throw new Error(
					result.stderr || result.stdout || 'Failed to refresh local admin checks.'
				);
			}
		},
	} );
}
