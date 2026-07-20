import type { ActivitySoundId } from '@studio/common/lib/activity-sounds';

type Tone = {
	frequency: number;
	delay?: number;
	duration: number;
	type: OscillatorType;
	volume: number;
	endFrequency?: number;
};

const PLACEHOLDER_CUES: Record< ActivitySoundId, Tone[] > = {
	'soft-chime': [
		{ frequency: 523.25, duration: 0.34, type: 'sine', volume: 0.5 },
		{ frequency: 659.25, delay: 0.1, duration: 0.42, type: 'sine', volume: 0.42 },
	],
	'bright-chime': [
		{ frequency: 659.25, duration: 0.22, type: 'triangle', volume: 0.34 },
		{ frequency: 987.77, delay: 0.11, duration: 0.32, type: 'triangle', volume: 0.28 },
	],
	pop: [
		{
			frequency: 440,
			endFrequency: 180,
			duration: 0.18,
			type: 'sine',
			volume: 0.56,
		},
	],
	pulse: [
		{ frequency: 220, duration: 0.09, type: 'square', volume: 0.13 },
		{ frequency: 293.66, delay: 0.11, duration: 0.1, type: 'square', volume: 0.11 },
	],
};

let audioContext: AudioContext | null = null;
const OUTPUT_GAIN = 0.12;

function getAudioContext(): AudioContext | null {
	if ( typeof window === 'undefined' ) {
		return null;
	}
	const AudioContextConstructor = window.AudioContext;
	if ( ! AudioContextConstructor ) {
		return null;
	}
	audioContext ??= new AudioContextConstructor();
	return audioContext;
}

export async function playActivitySound( soundId: ActivitySoundId ): Promise< void > {
	const context = getAudioContext();
	if ( ! context ) {
		return;
	}

	try {
		if ( context.state === 'suspended' ) {
			await context.resume();
		}

		const start = context.currentTime + 0.01;
		for ( const tone of PLACEHOLDER_CUES[ soundId ] ) {
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			const toneStart = start + ( tone.delay ?? 0 );
			const toneEnd = toneStart + tone.duration;

			oscillator.type = tone.type;
			oscillator.frequency.setValueAtTime( tone.frequency, toneStart );
			if ( tone.endFrequency ) {
				oscillator.frequency.exponentialRampToValueAtTime( tone.endFrequency, toneEnd );
			}

			gain.gain.setValueAtTime( 0.0001, toneStart );
			gain.gain.exponentialRampToValueAtTime( tone.volume * OUTPUT_GAIN, toneStart + 0.015 );
			gain.gain.exponentialRampToValueAtTime( 0.0001, toneEnd );
			oscillator.connect( gain );
			gain.connect( context.destination );
			oscillator.start( toneStart );
			oscillator.stop( toneEnd );
		}
	} catch {
		// Audio is optional feedback; blocked autoplay and unavailable output
		// devices should not affect the activity that triggered it.
	}
}
