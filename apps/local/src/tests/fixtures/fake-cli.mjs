// Stand-in for the Studio CLI in server tests. `site list` reports one site and
// `_events` keeps running, reporting a site event and an auth event in a loop.
// Every other command exits at once. When FAKE_CLI_PID_FILE is set, `_events`
// appends its process id there, so a test can check it is gone. With
// FAKE_CLI_SLOW_EXIT, `_events` takes 400 ms to exit after SIGTERM.
import { appendFileSync } from 'node:fs';

const site = {
	id: 's1',
	name: 'Fake site',
	path: '/Users/someone/Studio/fake-site',
	port: 8881,
	url: 'http://localhost:8881',
	phpVersion: '8.3',
	adminUsername: 'admin',
	adminPassword: 'secret-admin-password',
};

if ( process.argv.includes( '_events' ) && process.send ) {
	if ( process.env.FAKE_CLI_PID_FILE ) {
		appendFileSync( process.env.FAKE_CLI_PID_FILE, `${ process.pid }\n` );
	}
	if ( process.env.FAKE_CLI_SLOW_EXIT ) {
		process.on( 'SIGTERM', () => setTimeout( () => process.exit( 0 ), 400 ) );
	}
	setInterval( () => {
		process.send( {
			action: 'keyValuePair',
			key: 'auth-event',
			value: JSON.stringify( { event: 'auth-login' } ),
		} );
		process.send( {
			action: 'keyValuePair',
			key: 'site-event',
			value: JSON.stringify( { event: 'site-updated', siteId: site.id, site, running: true } ),
		} );
	}, 80 );
} else if ( process.argv.includes( 'list' ) && process.send ) {
	process.send( { action: 'result', value: [ { ...site, running: true } ] }, () =>
		process.exit( 0 )
	);
} else {
	process.exit( 0 );
}
