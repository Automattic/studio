import * as Sentry from '@sentry/electron/renderer';

export function setSentryWpcomUserIdRenderer( id: number | undefined ) {
	Sentry.setTag( 'wpcom.user.id', id );
}
