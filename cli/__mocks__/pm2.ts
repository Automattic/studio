class API {
	connect( callback: ( error: Error | null ) => void ) {
		setTimeout( () => {
			callback( null );
		}, 0 );
	}
	disconnect( callback: ( error: Error | null ) => void ) {
		setTimeout( () => {
			callback( null );
		}, 0 );
	}
	list( callback: ( error: Error | null, processes: any[] ) => void ) {
		setTimeout( () => {
			callback( null, [] );
		}, 0 );
	}
	launchBus( callback: ( error: Error | null, bus: any ) => void ) {
		setTimeout( () => {
			callback( null, {} );
		}, 0 );
	}
	sendDataToProcessId( id: string, data: any, callback: ( error: Error | null ) => void ) {
		setTimeout( () => {
			callback( null );
		}, 0 );
	}
	start( config: any, callback: ( error: Error | null, apps: any[] ) => void ) {
		setTimeout( () => {
			callback( null, [] );
		}, 0 );
	}
	delete( callback: ( error: Error | null ) => void ) {
		setTimeout( () => {
			callback( null );
		}, 0 );
	}
}

exports.custom = API;
