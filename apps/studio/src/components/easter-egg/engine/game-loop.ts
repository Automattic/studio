import {
	Player,
	Enemy,
	Collectible,
	Flag,
	createPlayer,
	spawnEntities,
	moveEntity,
	rectsOverlap,
} from './entities';
import { TILE_SIZE, LEVEL_WIDTH, getTile, isSolid } from './level';
import { renderGame, renderDeathScreen, renderWinScreen } from './renderer';
import { playSound } from './sounds';

const GRAVITY = 0.9;
const JUMP_FORCE = -14;
const MOVE_SPEED = 4.5;
const CANVAS_W = 480;
const CANVAS_H = 384;
const PLAYER_START_X = TILE_SIZE;
const PLAYER_START_Y = TILE_SIZE * 9;

type GameStatus = 'playing' | 'dead' | 'win';

interface GameState {
	player: Player;
	enemies: Enemy[];
	collectibles: Collectible[];
	flag: Flag | null;
	score: number;
	cameraX: number;
	status: GameStatus;
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
		status: 'playing',
	};
}

export function startGame( canvas: HTMLCanvasElement ): () => void {
	const ctx = canvas.getContext( '2d' )!;
	let state = initState();

	const keys: Set< string > = new Set();

	function onKeyDown( e: KeyboardEvent ) {
		keys.add( e.key );
		if ( state.status !== 'playing' ) {
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
	}

	window.addEventListener( 'keydown', onKeyDown, { capture: true } );
	window.addEventListener( 'keyup', onKeyUp );

	let rafId = 0;

	function tick() {
		update( state, keys );
		const { player, enemies, collectibles, flag, score, cameraX, status } = state;

		if ( status === 'playing' ) {
			renderGame(
				ctx,
				{ player, enemies, collectibles, flag, score, cameraX },
				CANVAS_W,
				CANVAS_H
			);
		} else if ( status === 'dead' ) {
			renderGame(
				ctx,
				{ player, enemies, collectibles, flag, score, cameraX },
				CANVAS_W,
				CANVAS_H
			);
			renderDeathScreen( ctx, CANVAS_W, CANVAS_H );
		} else {
			renderGame(
				ctx,
				{ player, enemies, collectibles, flag, score, cameraX },
				CANVAS_W,
				CANVAS_H
			);
			renderWinScreen( ctx, CANVAS_W, CANVAS_H, score );
		}

		rafId = requestAnimationFrame( tick );
	}

	rafId = requestAnimationFrame( tick );

	return () => {
		cancelAnimationFrame( rafId );
		window.removeEventListener( 'keydown', onKeyDown, { capture: true } );
		window.removeEventListener( 'keyup', onKeyUp );
	};
}

function update( state: GameState, keys: Set< string > ) {
	if ( state.status !== 'playing' ) return;

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
		if ( Math.abs( player.vx ) < 0.1 ) player.vx = 0;
	}

	// Jump
	if ( jumpPressed && player.onGround ) {
		player.vy = JUMP_FORCE;
		player.onGround = false;
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
	} else if ( Math.abs( player.vx ) > 0.2 ) {
		player.state = 'run';
	} else {
		player.state = 'idle';
	}
	player.animTimer++;
	if ( player.animTimer % 6 === 0 ) player.animFrame++;

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

		// Collision with player
		if ( player.invincibleTimer === 0 && rectsOverlap( player, e ) ) {
			const playerBottom = player.y + player.h;
			const enemyTop = e.y;
			if ( player.vy > 0 && playerBottom - enemyTop < 16 ) {
				// Stomp
				e.alive = false;
				player.vy = JUMP_FORCE * 0.6;
				state.score += 100;
				playSound( 'stomp' );
			} else {
				// Hit
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
			state.score += 50;
			playSound( 'collect' );
		}
	}

	// Flag
	if ( state.flag && rectsOverlap( player, state.flag ) ) {
		state.status = 'win';
		state.score += 500;
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
