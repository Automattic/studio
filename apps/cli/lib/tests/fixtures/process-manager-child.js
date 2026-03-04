process.stdout.write( 'fixture-stdout\n' );
process.stderr.write( 'fixture-stderr\n' );

if ( process.send ) {
	process.send( { topic: 'ready' } );

	process.on( 'message', ( message ) => {
		if ( ! process.send ) {
			return;
		}

		if ( message.topic === 'stop-server' ) {
			process.send( {
				topic: 'result',
				originalMessageId: message.messageId,
				result: { stopped: true },
			} );
			process.exit( 0 );
			return;
		}

		process.send( {
			topic: 'result',
			originalMessageId: message.messageId,
			result: {
				echo: message.topic,
			},
		} );
	} );
}
