import * as Sentry from '@sentry/electron/main';

export function setSentryWpcomUserIdMain( id: number | undefined ) {
	Sentry.setTag( 'wpcom.user.id', id );
}
