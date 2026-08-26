// Reused across game sessions intentionally — browsers cap AudioContext instances (~6/page)
// and closing/reopening on each game mount would burn through that limit quickly.
// Created lazily on first sound so the user gesture requirement is already satisfied.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
	if ( ! ctx ) {
		ctx = new AudioContext();
	}
	return ctx;
}

function sweep(
	startFreq: number,
	endFreq: number,
	duration: number,
	volume = 0.3,
	type: OscillatorType = 'square'
) {
	const ac = getCtx();
	const osc = ac.createOscillator();
	const gain = ac.createGain();
	osc.connect( gain );
	gain.connect( ac.destination );

	osc.type = type;
	osc.frequency.setValueAtTime( startFreq, ac.currentTime );
	osc.frequency.linearRampToValueAtTime( endFreq, ac.currentTime + duration );

	gain.gain.setValueAtTime( volume, ac.currentTime );
	gain.gain.linearRampToValueAtTime( 0, ac.currentTime + duration );

	osc.start( ac.currentTime );
	osc.stop( ac.currentTime + duration );
}

function note(
	freq: number,
	start: number,
	duration: number,
	volume = 0.25,
	type: OscillatorType = 'square'
) {
	const ac = getCtx();
	const osc = ac.createOscillator();
	const gain = ac.createGain();
	osc.connect( gain );
	gain.connect( ac.destination );

	osc.type = type;
	osc.frequency.setValueAtTime( freq, ac.currentTime + start );
	gain.gain.setValueAtTime( volume, ac.currentTime + start );
	gain.gain.linearRampToValueAtTime( 0, ac.currentTime + start + duration );

	osc.start( ac.currentTime + start );
	osc.stop( ac.currentTime + start + duration );
}

const sounds = {
	jump() {
		sweep( 220, 520, 0.12, 0.25, 'square' );
	},

	collect() {
		// Short rising arpeggio: C5 → E5 → G5
		note( 523, 0, 0.07 );
		note( 659, 0.07, 0.07 );
		note( 784, 0.14, 0.1 );
	},

	stomp() {
		sweep( 280, 60, 0.15, 0.35, 'sawtooth' );
	},

	hit() {
		// Buzzy descending with slight noise feel
		sweep( 440, 110, 0.2, 0.3, 'sawtooth' );
		sweep( 220, 80, 0.2, 0.15, 'square' );
	},

	die() {
		// Descending wah-wah
		note( 440, 0, 0.15, 0.3, 'sawtooth' );
		note( 330, 0.15, 0.15, 0.3, 'sawtooth' );
		note( 220, 0.3, 0.15, 0.3, 'sawtooth' );
		note( 110, 0.45, 0.25, 0.3, 'sawtooth' );
	},

	win() {
		// Ascending jingle: C E G C(high)
		note( 523, 0, 0.1 );
		note( 659, 0.1, 0.1 );
		note( 784, 0.2, 0.1 );
		note( 1047, 0.3, 0.25 );
		note( 784, 0.55, 0.08 );
		note( 1047, 0.63, 0.35 );
	},
};

export type SoundName = keyof typeof sounds;

export function playSound( name: SoundName ) {
	try {
		sounds[ name ]();
	} catch {
		// Silently ignore if audio context is unavailable
	}
}
