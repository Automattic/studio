export class EventLoopTester {
	private readonly intervalMs: number;
	private readonly label: string;
	private isRunning: boolean;
	private startTime: number;
	private iterationCount: number;
	constructor( intervalMs = 1000, label = 'EventLoopTester' ) {
		this.intervalMs = intervalMs;
		this.label = label;
		this.isRunning = false;
		this.startTime = null;
		this.iterationCount = 0;
	}

	start() {
		if ( this.isRunning ) {
			console.warn( `${ this.label }: Already running` );
			return;
		}

		this.isRunning = true;
		this.startTime = Date.now();
		this.iterationCount = 0;

		const tick = () => {
			if ( ! this.isRunning ) return;

			this.iterationCount++;
			const elapsedTime = Date.now() - this.startTime;
			// console.log(
			// 	`${ this.label }: Iteration ${ this.iterationCount } at ${ elapsedTime }ms ` +
			// 		`(expected: ${ this.iterationCount * this.intervalMs }ms, ` +
			// 		`drift: ${ elapsedTime - this.iterationCount * this.intervalMs }ms)`
			// );

			console.log( '🫥' + elapsedTime );

			setTimeout( tick, this.intervalMs );
		};

		console.log( `${ this.label }: Starting event loop tester` );
		setTimeout( tick, this.intervalMs );
	}

	stop() {
		if ( ! this.isRunning ) {
			console.warn( `${ this.label }: Not running` );
			return;
		}

		this.isRunning = false;
		console.log( `${ this.label }: Stopped after ${ this.iterationCount } iterations` );
	}
}
