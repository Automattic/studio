export class MessageQueue {
	private items: string[] = [];
	private waitResolve: ( ( message: string ) => void ) | null = null;
	onChange: ( () => void ) | null = null;

	enqueue( message: string ): void {
		if ( this.waitResolve ) {
			const resolve = this.waitResolve;
			this.waitResolve = null;
			resolve( message );
			return;
		}
		this.items.push( message );
		this.onChange?.();
	}

	dequeue(): Promise< string > {
		if ( this.items.length > 0 ) {
			const message = this.items.shift()!;
			this.onChange?.();
			return Promise.resolve( message );
		}
		return new Promise( ( resolve ) => {
			this.waitResolve = resolve;
		} );
	}

	remove( index: number ): void {
		if ( index < 0 || index >= this.items.length ) {
			return;
		}
		this.items.splice( index, 1 );
		this.onChange?.();
	}

	replace( index: number, newMessage: string ): void {
		if ( index < 0 || index >= this.items.length ) {
			return;
		}
		this.items[ index ] = newMessage;
		this.onChange?.();
	}

	pending(): readonly string[] {
		return [ ...this.items ];
	}

	get length(): number {
		return this.items.length;
	}
}
