// A small key-value store over IndexedDB: everything Studio on the web keeps
// lives in this browser profile (site files live in Playground's OPFS).

const DB_NAME = 'studio-web';
const STORE = 'kv';

let dbPromise: Promise< IDBDatabase > | undefined;

function openDb(): Promise< IDBDatabase > {
	dbPromise ??= new Promise( ( resolve, reject ) => {
		const request = indexedDB.open( DB_NAME, 1 );
		request.onupgradeneeded = () => request.result.createObjectStore( STORE );
		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( request.error );
	} );
	return dbPromise;
}

async function run< T >(
	mode: IDBTransactionMode,
	operation: ( store: IDBObjectStore ) => IDBRequest
): Promise< T > {
	const db = await openDb();
	return new Promise( ( resolve, reject ) => {
		const request = operation( db.transaction( STORE, mode ).objectStore( STORE ) );
		request.onsuccess = () => resolve( request.result as T );
		request.onerror = () => reject( request.error );
	} );
}

export function kvGet< T >( key: string ): Promise< T | undefined > {
	return run< T | undefined >( 'readonly', ( store ) => store.get( key ) );
}

export async function kvSet< T >( key: string, value: T ): Promise< void > {
	await run( 'readwrite', ( store ) => store.put( value, key ) );
}

export async function kvDelete( key: string ): Promise< void > {
	await run( 'readwrite', ( store ) => store.delete( key ) );
}

// Read-modify-write for one key. Updates to the same key are serialized so
// concurrent callers never drop each other's changes.
const queues = new Map< string, Promise< unknown > >();
export function kvUpdate< T >(
	key: string,
	fallback: T,
	update: ( current: T ) => T
): Promise< T > {
	const previous = queues.get( key ) ?? Promise.resolve();
	const next = previous.then( async () => {
		const value = update( ( await kvGet< T >( key ) ) ?? fallback );
		await kvSet( key, value );
		return value;
	} );
	queues.set(
		key,
		next.catch( () => undefined )
	);
	return next;
}
