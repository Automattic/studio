class Socket {
	connect() {
		// Do nothing
	}
	bind() {
		// Do nothing
	}
	close() {
		// Do nothing
	}
	once( event: string, callback: () => void ) {
		setTimeout( () => {
			callback();
		}, 0 );
	}
	send() {
		// Do nothing
	}
}

module.exports = {
	socket() {
		return new Socket();
	},
};
