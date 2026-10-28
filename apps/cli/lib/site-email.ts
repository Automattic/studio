/**
 * Catches the email a Studio site sends.
 *
 * PHP's `mail()`, which `wp_mail()` uses, pipes each message to the `sendmail_path`
 * command. Left at PHP's default, that is a sendmail no local machine has set up, so
 * the message is dropped while `mail()` still reports success. Studio sets
 * `sendmail_path` to its own `php/sendmail.php` instead, which saves each message as
 * an `.eml` file in the site's email folder.
 */
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

// Under Studio's own directory rather than the site's, so a site's email is never
// committed, pushed or synced with its files.
export function getSiteEmailDirectory( siteId: string ): string {
	return path.join( getConfigDirectory(), 'email', siteId );
}
