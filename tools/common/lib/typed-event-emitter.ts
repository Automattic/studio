import EventEmitter from 'node:events';

type Listener< TPayload > = [ TPayload ] extends [ void ]
	? () => void
	: ( payload: TPayload ) => void;
type EmitArgs< TPayload > = [ TPayload ] extends [ void ] ? [] : [ payload: TPayload ];

export class TypedEventEmitter< TEventMap extends Record< string, unknown > > extends EventEmitter {
	on< K extends keyof TEventMap & string >( event: K, listener: Listener< TEventMap[ K ] > ): this {
		return super.on( event, listener as ( ...args: unknown[] ) => void );
	}

	emit< K extends keyof TEventMap & string >(
		event: K,
		...args: EmitArgs< TEventMap[ K ] >
	): boolean {
		return super.emit( event, ...( args as unknown[] ) );
	}
}
