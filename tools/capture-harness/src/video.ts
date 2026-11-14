/**
 * Records a shot's steps as video. Frames come from the driver's own capture
 * (as stills do), taken at the look's frame rate while the steps play at a
 * watchable pace (`Ctx.recording`), then encoded as animated WebP or GIF with
 * sharp, or as WebM or MP4 with ffmpeg.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { Ctx } from './context.ts';
import type { Look } from './schema.ts';

type VideoFormat = Look[ 'video' ][ 'formats' ][ number ];

interface Frame {
	at: number;
	jpeg: Buffer;
}

const CURSOR_ID = 'studio-capture-cursor';
const TIDY_ID = 'studio-capture-tidy';

/**
 * Draws a pointer that follows the mouse, since captures leave the system's
 * out, and dips it on each click.
 */
export async function showCursor( ctx: Ctx ) {
	await ctx.w.evaluate( ( id ) => {
		document.getElementById( id )?.remove();
		const cursor = document.createElement( 'div' );
		cursor.id = id;
		cursor.innerHTML =
			'<svg width="22" height="24" viewBox="0 0 22 24" xmlns="http://www.w3.org/2000/svg"><path d="M2 1.5v18.2l4.6-4.4 3.1 7.1 3.3-1.4-3.1-7h6.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
		Object.assign( cursor.style, {
			position: 'fixed',
			left: '0',
			top: '0',
			width: '22px',
			height: '24px',
			pointerEvents: 'none',
			zIndex: '2147483647',
			transformOrigin: '2px 2px',
			transition: 'scale 120ms ease-out',
			filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))',
			translate: `${ innerWidth / 2 }px ${ innerHeight / 2 }px`,
		} );
		document.body.appendChild( cursor );
		const follow = ( event: MouseEvent ) => {
			cursor.style.translate = `${ event.clientX - 2 }px ${ event.clientY - 2 }px`;
		};
		addEventListener( 'mousemove', follow, true );
		addEventListener( 'mousedown', () => ( cursor.style.scale = '0.82' ), true );
		addEventListener( 'mouseup', () => ( cursor.style.scale = '1' ), true );
	}, CURSOR_ID );
	const box = await ctx.w.evaluate( () => ( { width: innerWidth, height: innerHeight } ) );
	await ctx.w.mouse.move( box.width / 2, box.height / 2 );
}

export async function hideCursor( ctx: Ctx ) {
	await ctx.w
		.evaluate( ( id ) => document.getElementById( id )?.remove(), CURSOR_ID )
		.catch( () => {} );
}

/**
 * Keeps `replacements` applied to the window's text as it renders, for the
 * frames of a recording, which are taken between steps rather than after a
 * tidy-up as stills are. Returns a function that stops it.
 */
export async function keepTidy( ctx: Ctx, replacements: [ string, string ][] ) {
	if ( ! replacements.length ) {
		return () => Promise.resolve();
	}
	await ctx.w.evaluate(
		( { id, pairs } ) => {
			const fix = ( s: string ) =>
				pairs.reduce( ( text, [ from, to ] ) => text.split( from ).join( to ), s );
			const tidy = ( root: Node ) => {
				const walker = document.createTreeWalker( root, NodeFilter.SHOW_TEXT );
				for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
					const value = fix( node.nodeValue ?? '' );
					if ( value !== node.nodeValue ) {
						node.nodeValue = value;
					}
				}
			};
			const observer = new MutationObserver( ( records ) => {
				for ( const record of records ) {
					tidy(
						record.type === 'characterData'
							? record.target.parentNode ?? record.target
							: record.target
					);
				}
			} );
			observer.observe( document.body, { subtree: true, childList: true, characterData: true } );
			tidy( document.body );
			( window as unknown as Record< string, MutationObserver > )[ id ] = observer;
		},
		{ id: TIDY_ID, pairs: replacements }
	);
	return () =>
		ctx.w
			.evaluate( ( id ) => {
				( window as unknown as Record< string, MutationObserver | undefined > )[ id ]?.disconnect();
			}, TIDY_ID )
			.catch( () => {} );
}

/**
 * The frames at a steady `fps`: for each tick, the latest frame taken by
 * then. Frames come when the capture keeps up, not exactly on the tick.
 */
export function resample< T extends { at: number } >( frames: T[], fps: number ): T[] {
	if ( ! frames.length ) {
		return [];
	}
	const step = 1000 / fps;
	const end = frames[ frames.length - 1 ].at;
	const out: T[] = [];
	let index = 0;
	for ( let t = frames[ 0 ].at; t <= end + step / 2; t += step ) {
		while ( index + 1 < frames.length && frames[ index + 1 ].at <= t ) {
			index++;
		}
		out.push( frames[ index ] );
	}
	return out;
}

/** Runs of the same frame merged into one frame shown for longer. */
export function collapseRepeats< T >( frames: T[], delay: number ) {
	const out: { frame: T; delay: number }[] = [];
	for ( const frame of frames ) {
		const last = out[ out.length - 1 ];
		if ( last && last.frame === frame ) {
			last.delay += delay;
		} else {
			out.push( { frame, delay } );
		}
	}
	return out;
}

/** An ffmpeg that can write `format`: `FFMPEG_PATH`, one on PATH, or Playwright's for WebM. */
function findFfmpeg( format: 'webm' | 'mp4' ): string | null {
	const candidates = [ process.env.FFMPEG_PATH, 'ffmpeg' ].filter( Boolean ) as string[];
	for ( const candidate of candidates ) {
		if ( ! spawnSync( candidate, [ '-version' ], { stdio: 'ignore' } ).error ) {
			return candidate;
		}
	}
	if ( format !== 'webm' ) {
		return null;
	}
	// Playwright downloads a small ffmpeg that writes VP8/VP9 WebM, for its own recordings.
	const cache =
		process.env.PLAYWRIGHT_BROWSERS_PATH ??
		{
			darwin: path.join( homedir(), 'Library/Caches/ms-playwright' ),
			win32: path.join( process.env.LOCALAPPDATA ?? '', 'ms-playwright' ),
		}[ process.platform as string ] ??
		path.join( homedir(), '.cache/ms-playwright' );
	const exe =
		{ darwin: 'ffmpeg-mac', win32: 'ffmpeg-win64.exe' }[ process.platform as string ] ??
		'ffmpeg-linux';
	const dirs = existsSync( cache )
		? readdirSync( cache )
				.filter( ( name ) => name.startsWith( 'ffmpeg-' ) )
				.sort()
				.reverse()
		: [];
	const found = dirs.map( ( dir ) => path.join( cache, dir, exe ) ).find( existsSync );
	return found ?? null;
}

async function encodeWithFfmpeg( ffmpeg: string, frames: Frame[], fps: number, file: string ) {
	const codec =
		path.extname( file ) === '.mp4'
			? [ '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart' ]
			: [ '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1' ];
	const child = spawn(
		ffmpeg,
		[
			'-y',
			'-loglevel',
			'error',
			'-f',
			'image2pipe',
			'-c:v',
			'mjpeg',
			'-framerate',
			String( fps ),
			'-i',
			// Playwright's ffmpeg reads stdin only by this name.
			'pipe:0',
			'-vf',
			'scale=trunc(iw/2)*2:trunc(ih/2)*2',
			...codec,
			file,
		],
		{ stdio: [ 'pipe', 'ignore', 'pipe' ] }
	);
	let stderr = '';
	child.stderr.on( 'data', ( chunk ) => ( stderr += chunk ) );
	// ffmpeg failing closes its stdin; its own error is reported below.
	child.stdin.on( 'error', () => {} );
	const done = new Promise< void >( ( resolve, reject ) => {
		child.on( 'error', reject );
		child.on( 'close', ( code ) =>
			code === 0
				? resolve()
				: reject( new Error( `ffmpeg failed (${ code }): ${ stderr.trim() }` ) )
		);
	} );
	for ( const frame of frames ) {
		if ( child.stdin.destroyed ) {
			break;
		}
		if ( ! child.stdin.write( frame.jpeg ) ) {
			await Promise.race( [
				new Promise( ( resolve ) => child.stdin.once( 'drain', resolve ) ),
				done.catch( () => {} ),
			] );
		}
	}
	child.stdin.end();
	await done;
}

export interface VideoResult {
	file: string;
	format: VideoFormat;
	frames: number;
	durationMs: number;
}

/**
 * Writes the frames in each of the look's formats as `<base>.<format>`.
 * A format whose encoder is missing is skipped with a warning, so one run
 * still writes the rest.
 */
export async function encodeVideo(
	rawFrames: Frame[],
	video: Look[ 'video' ],
	base: string,
	warn: ( message: string ) => void
): Promise< VideoResult[] > {
	const frames = resample( rawFrames, video.fps );
	if ( ! frames.length ) {
		throw new Error( 'The recording has no frames.' );
	}
	await mkdir( path.dirname( base ), { recursive: true } );
	const delay = Math.round( 1000 / video.fps );
	const durationMs = frames.length * delay;
	const results: VideoResult[] = [];
	for ( const format of video.formats ) {
		const file = `${ base }.${ format }`;
		if ( format === 'webm' || format === 'mp4' ) {
			const ffmpeg = findFfmpeg( format );
			if ( ! ffmpeg ) {
				warn( `Skipped ${ path.basename( file ) }: ${ format } needs ffmpeg (set FFMPEG_PATH).` );
				continue;
			}
			await encodeWithFfmpeg( ffmpeg, frames, video.fps, file );
		} else {
			const runs = collapseRepeats( frames, delay );
			const animated = sharp(
				runs.map( ( run ) => run.frame.jpeg ),
				{ join: { animated: true } }
			);
			const delays = runs.map( ( run ) => run.delay );
			await ( format === 'gif'
				? animated.gif( { delay: delays, loop: 0, effort: 7 } )
				: animated.webp( { delay: delays, loop: 0, quality: 85, effort: 4 } )
			).toFile( file );
		}
		results.push( { file, format, frames: frames.length, durationMs } );
	}
	return results;
}
