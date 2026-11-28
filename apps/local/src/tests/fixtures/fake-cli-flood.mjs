// Stand-in for the Studio CLI that floods the server with large site events, so
// a client that stops reading makes the server's output buffers back up.
// Every command other than `_events` exits at once.
const site = {
	id: 's1',
	// The name is the one field of the event that reaches a phone unchanged.
	name: 'x'.repeat( 200_000 ),
	path: '/Users/someone/Studio/fake-site',
	port: 8881,
	url: 'http://localhost:8881',
	phpVersion: '8.3',
	adminUsername: 'admin',
	adminPassword: 'secret-admin-password',
};

if ( process.argv.includes( '_events' ) && process.send ) {
	setInterval( () => {
		process.send( {
			action: 'keyValuePair',
			key: 'site-event',
			value: JSON.stringify( { event: 'site-updated', siteId: site.id, site, running: true } ),
		} );
	}, 10 );
} else {
	process.exit( 0 );
}
