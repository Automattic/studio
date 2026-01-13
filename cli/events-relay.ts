interface RelayMessage {
	topic?: string;
	data?: unknown;
}

process.on( 'message', ( packet: unknown ) => {
	if ( process.send && packet && typeof packet === 'object' ) {
		const msg = packet as RelayMessage;
		if ( msg.topic && msg.data ) {
			process.send( { topic: msg.topic, data: msg.data } );
		}
	}
} );

setInterval( () => {}, 60000 );
