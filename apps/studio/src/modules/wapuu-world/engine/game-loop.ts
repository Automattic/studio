import {
	Player,
	Enemy,
	Collectible,
	Flag,
	createPlayer,
	spawnEntities,
	moveEntity,
	rectsOverlap,
	INITIAL_LIVES,
} from './entities';
import { TILE_SIZE, LEVEL_WIDTH, LEVEL_MAP, getTile, isSolid } from './level';
import { renderGame, renderDeathScreen, renderWinScreen, renderStartScreen } from './renderer';
import { playSound } from './sounds';

const GRAVITY = 0.9;
const JUMP_FORCE = -14;
const MOVE_SPEED = 4.5;
export const CANVAS_W = 480;
export const CANVAS_H = 384;
const PLAYER_START_X = TILE_SIZE;
const PLAYER_START_Y = TILE_SIZE * 9;
const TIME_LIMIT = 90; // seconds
const TIME_BONUS_PER_SECOND = 20;
const LIVES_BONUS = 500;
const AUTO_START_DELAY = 5 * 60; // frames at 60fps

const SCORE_FLAG = 500;
const SCORE_COLLECTIBLE = 50;
const SCORE_ENEMY = 100;
const SCORE_MGUY = 500;

export const MAX_SCORE = ( () => {
	const flat = LEVEL_MAP.flat();
	const coins = flat.filter( ( t ) => t === 3 ).length;
	const enemies = flat.filter( ( t ) => t === 5 ).length;
	const mguys = flat.filter( ( t ) => t === 7 ).length;
	return (
		SCORE_FLAG +
		TIME_LIMIT * TIME_BONUS_PER_SECOND +
		INITIAL_LIVES * LIVES_BONUS +
		coins * SCORE_COLLECTIBLE +
		enemies * SCORE_ENEMY +
		mguys * SCORE_MGUY
	);
} )();

type GameStatus = 'start' | 'playing' | 'dead' | 'win';

interface GameState {
	player: Player;
	enemies: Enemy[];
	collectibles: Collectible[];
	flag: Flag | null;
	score: number;
	cameraX: number;
	status: GameStatus;
	timeLeft: number; // seconds remaining
	startTimer: number; // frames until auto-start
	playFrames: number; // frames elapsed while playing
}

function initState(): GameState {
	const { enemies, collectibles, flag } = spawnEntities();
	return {
		player: createPlayer( PLAYER_START_X, PLAYER_START_Y ),
		enemies,
		collectibles,
		flag,
		score: 0,
		cameraX: 0,
		status: 'start',
		timeLeft: TIME_LIMIT,
		startTimer: AUTO_START_DELAY,
		playFrames: 0,
	};
}

export function startGame( canvas: HTMLCanvasElement ): () => void {
	const ctx = canvas.getContext( '2d' )!;
	let state = initState();

	const keys: Set< string > = new Set();
	let debugHitboxes = false;
	const jumpEdge = { consumed: false };

	function onKeyDown( e: KeyboardEvent ) {
		keys.add( e.key );
		if ( e.key === '`' || e.key === '~' ) {
			debugHitboxes = ! debugHitboxes;
		}
		if ( state.status === 'start' ) {
			if ( e.key === 'Enter' || e.key === ' ' ) {
				state.status = 'playing';
			}
		} else if ( state.status === 'dead' || state.status === 'win' ) {
			if ( e.key === 'Enter' || e.key === ' ' ) {
				state = initState();
			}
		}
		// Prevent arrow keys from scrolling the page
		if ( [ 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ' ].includes( e.key ) ) {
			e.preventDefault();
			e.stopPropagation();
		}
	}
	function onKeyUp( e: KeyboardEvent ) {
		keys.delete( e.key );
		if ( e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ' ) {
			jumpEdge.consumed = false;
		}
	}

	window.addEventListener( 'keydown', onKeyDown, { capture: true } );
	window.addEventListener( 'keyup', onKeyUp );

	let rafId = 0;
	let cancelled = false;
	const TARGET_MS = 1000 / 60;
	let lastTime = 0;
	let accumulator = 0;

	function tick( now: number ) {
		const delta = Math.min( now - lastTime, 100 ); // cap at 100ms to avoid spiral on tab switch
		lastTime = now;
		accumulator += delta;

		while ( accumulator >= TARGET_MS ) {
			update( state, keys, jumpEdge );
			accumulator -= TARGET_MS;
		}
		const { player, enemies, collectibles, flag, score, cameraX, status, timeLeft } = state;
		const gameState = { player, enemies, collectibles, flag, score, cameraX, timeLeft };

		if ( status === 'start' ) {
			renderGame( ctx, gameState, CANVAS_W, CANVAS_H, debugHitboxes );
			renderStartScreen( ctx, CANVAS_W, CANVAS_H, state.startTimer );
		} else if ( status === 'playing' ) {
			renderGame( ctx, gameState, CANVAS_W, CANVAS_H, debugHitboxes );
		} else if ( status === 'dead' ) {
			renderGame( ctx, gameState, CANVAS_W, CANVAS_H, debugHitboxes );
			renderDeathScreen( ctx, CANVAS_W, CANVAS_H );
		} else {
			renderGame( ctx, gameState, CANVAS_W, CANVAS_H, debugHitboxes );
			renderWinScreen( ctx, CANVAS_W, CANVAS_H, score );
		}

		rafId = requestAnimationFrame( tick );
	}

	rafId = requestAnimationFrame( ( now ) => {
		if ( cancelled ) return;
		lastTime = now;
		rafId = requestAnimationFrame( tick );
	} );

	return () => {
		cancelled = true;
		cancelAnimationFrame( rafId );
		window.removeEventListener( 'keydown', onKeyDown, { capture: true } );
		window.removeEventListener( 'keyup', onKeyUp );
		keys.clear();
	};
}

function update( state: GameState, keys: Set< string >, jumpEdge: { consumed: boolean } ) {
	if ( state.status === 'start' ) {
		state.startTimer--;
		if ( state.startTimer <= 0 ) {
			state.status = 'playing';
		}
		return;
	}
	if ( state.status !== 'playing' ) return;

	// Countdown timer
	state.playFrames++;
	state.timeLeft = Math.max( 0, TIME_LIMIT - Math.floor( state.playFrames / 60 ) );
	if ( state.timeLeft <= 0 ) {
		state.status = 'dead';
		playSound( 'die' );
		return;
	}

	const { player } = state;

	// Horizontal input
	const left = keys.has( 'ArrowLeft' ) || keys.has( 'a' );
	const right = keys.has( 'ArrowRight' ) || keys.has( 'd' );
	const jumpPressed = keys.has( 'ArrowUp' ) || keys.has( 'w' ) || keys.has( ' ' );

	if ( left ) {
		player.vx = -MOVE_SPEED;
		player.facingRight = false;
	} else if ( right ) {
		player.vx = MOVE_SPEED;
		player.facingRight = true;
	} else {
		player.vx *= 0.7;
		if ( Math.abs( player.vx ) < 0.2 ) player.vx = 0;
	}

	// Jump — only on fresh keypress, not while held
	if ( jumpPressed && ! jumpEdge.consumed && player.onGround ) {
		player.vy = JUMP_FORCE;
		player.onGround = false;
		jumpEdge.consumed = true;
		playSound( 'jump' );
	}

	// Gravity
	player.vy += GRAVITY;
	if ( player.vy > 14 ) player.vy = 14;

	moveEntity( player );

	// Clamp to level bounds
	if ( player.x < 0 ) player.x = 0;
	if ( player.x + player.w > LEVEL_WIDTH ) player.x = LEVEL_WIDTH - player.w;

	// Animation state
	if ( ! player.onGround ) {
		player.state = 'jump';
	} else if ( player.vx !== 0 ) {
		player.state = 'run';
	} else {
		player.state = 'idle';
	}
	if ( player.vx !== 0 ) {
		player.animTimer++;
		if ( player.animTimer % 6 === 0 ) player.animFrame++;
	} else if ( player.animTimer !== 0 ) {
		player.animFrame = 0;
		player.animTimer = 0;
	}

	if ( player.invincibleTimer > 0 ) player.invincibleTimer--;

	// Camera follow
	const targetCameraX = player.x - CANVAS_W / 2 + player.w / 2;
	state.cameraX += ( targetCameraX - state.cameraX ) * 0.15;
	state.cameraX = Math.max( 0, Math.min( state.cameraX, LEVEL_WIDTH - CANVAS_W ) );

	// Enemies
	for ( const e of state.enemies ) {
		if ( ! e.alive ) continue;
		e.vy += GRAVITY;
		moveEntity( e );
		e.animTimer++;
		if ( e.animTimer % 8 === 0 ) e.animFrame++;

		// Reverse at level bounds or when ground ahead disappears
		const groundRow = Math.floor( ( e.y + e.h + 2 ) / TILE_SIZE );
		const frontCol =
			e.vx > 0
				? Math.floor( ( e.x + e.w + 1 ) / TILE_SIZE )
				: Math.floor( ( e.x - 1 ) / TILE_SIZE );
		const groundAhead = isSolid( getTile( frontCol, groundRow ) );
		const nextX = e.x + e.vx;
		if ( nextX < 0 || nextX + e.w > LEVEL_WIDTH || ! groundAhead ) e.vx *= -1;

		// Hurt timer tick (makes boss flash after first stomp)
		if ( e.hurtTimer > 0 ) e.hurtTimer--;

		// Collision with player
		if ( rectsOverlap( player, e ) ) {
			const playerBottom = player.y + player.h;
			const enemyTop = e.y;
			if ( player.vy > 0 && playerBottom - enemyTop < 16 ) {
				// Stomp — always works regardless of invincibility
				e.health--;
				player.vy = JUMP_FORCE * 0.6;
				playSound( 'stomp' );
				if ( e.health <= 0 ) {
					e.alive = false;
					state.score += e.type === 'mguy' ? SCORE_MGUY : SCORE_ENEMY;
				} else {
					// First stomp on mguy — stun briefly and flash
					e.hurtTimer = 60;
					e.vx *= 1.5;
				}
			} else if ( player.invincibleTimer === 0 && e.hurtTimer === 0 ) {
				// Hit player — only when not invincible, mguy can't hurt while stunned
				player.lives--;
				player.invincibleTimer = 90;
				if ( player.lives <= 0 ) {
					state.status = 'dead';
					playSound( 'die' );
				} else {
					playSound( 'hit' );
				}
			}
		}
	}

	// Collectibles
	for ( const c of state.collectibles ) {
		if ( c.collected ) continue;
		c.animTimer++;
		if ( c.animTimer % 4 === 0 ) c.animFrame++;
		if ( rectsOverlap( player, c ) ) {
			c.collected = true;
			state.score += SCORE_COLLECTIBLE;
			playSound( 'collect' );
		}
	}

	// Flag
	if ( state.flag && rectsOverlap( player, state.flag ) ) {
		state.status = 'win';
		state.score += SCORE_FLAG + state.timeLeft * TIME_BONUS_PER_SECOND + player.lives * LIVES_BONUS;
		playSound( 'win' );
		void window.ipcApi.saveWapuuScore( state.score );
	}

	// Fell off world
	if ( player.y > TILE_SIZE * 11 ) {
		player.lives--;
		if ( player.lives <= 0 ) {
			state.status = 'dead';
			playSound( 'die' );
		} else {
			playSound( 'hit' );
			player.x = PLAYER_START_X;
			player.y = PLAYER_START_Y;
			player.vx = 0;
			player.vy = 0;
			player.invincibleTimer = 60;
		}
	}
}
