import bgFarUrl from '../assets/wapuu-bg-far.png';
import bgNearUrl from '../assets/wapuu-bg-near.png';
import flagSpriteUrl from '../assets/wapuu-flag-sprite.png';
import gutenbergSpriteUrl from '../assets/wapuu-gutenberg-sprite.png';
import mguySpriteUrl from '../assets/wapuu-mguy-sprite.png';
import wapuuPlayerIdleSpriteUrl from '../assets/wapuu-player-idle-sprite.png';
import wapuuPlayerSpriteUrl from '../assets/wapuu-player-sprite.png';
import coinSpriteUrl from '../assets/wapuu-sprites-coin.png';
import tilesSpriteUrl from '../assets/wapuu-sprites-tiles.png';
import waveSpriteUrl from '../assets/wapuu-wave-sprite.png';
import { Player, Enemy, Collectible, Flag } from './entities';
import { TILE_SIZE, LEVEL_MAP, getTile } from './level';

function loadImage( url: string ): { img: HTMLImageElement; ready: boolean } {
	const entry = { img: new Image(), ready: false };
	entry.img.onload = () => {
		entry.ready = true;
	};
	entry.img.onerror = () => {
		console.warn( `[wapuu-world] sprite failed to load: ${ url }` );
	};
	entry.img.src = url;
	return entry;
}

type SpriteEntry = { img: HTMLImageElement; ready: boolean };
type SpriteMap = {
	tiles: SpriteEntry;
	coin: SpriteEntry;
	bgFar: SpriteEntry;
	bgNear: SpriteEntry;
	flag: SpriteEntry;
	wave: SpriteEntry;
	gutenberg: SpriteEntry;
	mguy: SpriteEntry;
	wapuu: SpriteEntry;
	wapuuIdle: SpriteEntry;
};

// Sprites load lazily on first access so importers of this module (and its
// transitive dependents like wapuu-score.tsx, which pulls in MAX_SCORE via
// game-loop.ts) don't trigger image network requests at module evaluation.
let _sprites: SpriteMap | null = null;

function getSprites(): SpriteMap {
	if ( ! _sprites ) {
		_sprites = {
			tiles: loadImage( tilesSpriteUrl ),
			coin: loadImage( coinSpriteUrl ),
			bgFar: loadImage( bgFarUrl ),
			bgNear: loadImage( bgNearUrl ),
			flag: loadImage( flagSpriteUrl ),
			wave: loadImage( waveSpriteUrl ),
			gutenberg: loadImage( gutenbergSpriteUrl ),
			mguy: loadImage( mguySpriteUrl ),
			wapuu: loadImage( wapuuPlayerSpriteUrl ),
			wapuuIdle: loadImage( wapuuPlayerIdleSpriteUrl ),
		};
	}
	return _sprites;
}

function drawTileSprite(
	ctx: CanvasRenderingContext2D,
	dx: number,
	dy: number,
	dw = TILE_SIZE,
	dh = TILE_SIZE,
	frame = 0
) {
	const { img, ready } = getSprites().tiles;
	if ( ! ready ) return false;
	const frameW = img.naturalWidth / 2;
	ctx.drawImage( img, frame * frameW, 0, frameW, img.naturalHeight, dx, dy, dw, dh );
	return true;
}

const COLORS = {
	sky: '#1a8cff',
	skyBottom: '#87ceeb',
	ground: '#5d3a1a',
	groundTop: '#4a7c2f',
	platform: '#8b6914',
	platformTop: '#c8a43c',
	hill: '#2d6e1f',
	wapuuBody: '#e8e0d0',
	wapuuHat: '#21759b',
	wapuuEar: '#e8d0b0',
	wapuuEye: '#2c1810',
	wapuuBelly: '#f0e8d8',
	wapuuPaw: '#e8c890',
	enemyBody: '#cc3333',
	enemyEye: '#fff',
	collectible: '#f5a623',
	collectibleShine: '#fff8e0',
	flagPole: '#888',
	flagBanner: '#21759b',
	hud: 'rgba(0,0,0,0.5)',
	hudText: '#fff',
};

function drawBackground( ctx: CanvasRenderingContext2D, cameraX: number, w: number, h: number ) {
	const grad = ctx.createLinearGradient( 0, 0, 0, h );
	grad.addColorStop( 0, COLORS.sky );
	grad.addColorStop( 1, COLORS.skyBottom );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, w, h );

	// Far background layer (parallax at 0.2x speed, bottom-aligned)
	const { img: bgImg, ready: bgReady } = getSprites().bgFar;
	if ( bgReady ) {
		const zoom = 1.2;
		const bgW = bgImg.naturalWidth;
		const bgH = bgImg.naturalHeight;
		// Destination tile size: full image scaled by zoom
		const dw = bgW * zoom;
		// Source crop from bottom to match canvas height
		const srcH = Math.min( bgH, h / zoom );
		const srcY = bgH - srcH; // bottom-aligned
		const destH = srcH * zoom; // = h when image is tall enough
		const offset = ( ( ( cameraX * 0.2 ) % dw ) + dw ) % dw;
		for ( let dx = -offset; dx < w; dx += dw ) {
			ctx.drawImage( bgImg, 0, srcY, bgW, srcH, dx, h - destH, dw, destH );
		}
	}

	// Near background layer (parallax at 0.5x speed, bottom-aligned)
	const { img: nearImg, ready: nearReady } = getSprites().bgNear;
	if ( nearReady ) {
		const zoom = 0.6;
		const nearW = nearImg.naturalWidth;
		const nearH = nearImg.naturalHeight;
		const scale = ( h / nearH ) * zoom;
		const dw = nearW * scale;
		const dh = nearH * scale;
		// Keep offset in [0, dw) to avoid float drift at large cameraX
		const offset = ( ( ( cameraX * 0.5 ) % dw ) + dw ) % dw;
		const startX = -offset;
		for ( let dx = startX; dx < w; dx += dw ) {
			ctx.drawImage( nearImg, 0, 0, nearW, nearH, dx, h - dh, dw, dh );
		}
	} else {
		// Fallback parallax hills while image loads
		ctx.fillStyle = COLORS.hill;
		const hillOffset = ( cameraX * 0.3 ) % 200;
		for ( let i = -1; i < Math.ceil( w / 200 ) + 1; i++ ) {
			const hx = i * 200 - hillOffset;
			ctx.beginPath();
			ctx.arc( hx + 100, h - 60, 80, Math.PI, 0 );
			ctx.fill();
			ctx.beginPath();
			ctx.arc( hx + 180, h - 40, 60, Math.PI, 0 );
			ctx.fill();
		}
	}
}

let waterTick = 0;

function drawWater( ctx: CanvasRenderingContext2D, cameraX: number, _w: number, h: number ) {
	const pitRow = LEVEL_MAP.length - 1;
	const tileY = pitRow * TILE_SIZE;
	const waterDepth = h - tileY;
	const waterOffset = Math.floor( waterDepth / 3 );
	const surfaceY = tileY + waterOffset;
	const frame = Math.floor( waterTick / 20 ) % 2;
	const { img: waveImg, ready: waveReady } = getSprites().wave;

	for ( let col = 0; col < LEVEL_MAP[ 0 ].length; col++ ) {
		if ( LEVEL_MAP[ pitRow ][ col ] !== 0 ) continue;

		const tx = col * TILE_SIZE - cameraX;

		// Body
		ctx.fillStyle = 'rgba(30, 100, 220, 0.75)';
		ctx.fillRect( tx, surfaceY + 6, TILE_SIZE, h - surfaceY - 6 );

		// Surface wave
		if ( waveReady ) {
			ctx.drawImage( waveImg, frame * 32, 0, 32, 32, tx, surfaceY - 8, TILE_SIZE, 32 );
		} else {
			ctx.fillStyle = 'rgba(100, 180, 255, 0.9)';
			const waveY = surfaceY + 2 + Math.sin( waterTick * 0.05 + col * 0.8 ) * 3;
			ctx.fillRect( tx, waveY, TILE_SIZE, 4 );
		}
	}
}

function drawTiles( ctx: CanvasRenderingContext2D, cameraX: number, w: number, _h: number ) {
	const startCol = Math.max( 0, Math.floor( cameraX / TILE_SIZE ) - 1 );
	const endCol = Math.min( LEVEL_MAP[ 0 ].length - 1, Math.ceil( ( cameraX + w ) / TILE_SIZE ) );

	for ( let row = 0; row < LEVEL_MAP.length; row++ ) {
		for ( let col = startCol; col <= endCol; col++ ) {
			const tile = getTile( col, row );
			if ( tile !== 1 && tile !== 2 && tile !== 8 ) continue;

			const tx = col * TILE_SIZE - cameraX;
			const ty = row * TILE_SIZE;
			const frame = tile === 8 ? 1 : 0;

			const drawn = drawTileSprite( ctx, tx - 1, ty, TILE_SIZE + 2, TILE_SIZE + 1, frame );
			if ( ! drawn ) {
				// Fallback procedural while sprite loads
				if ( tile === 1 ) {
					ctx.fillStyle = COLORS.groundTop;
					ctx.fillRect( tx, ty, TILE_SIZE, 8 );
					ctx.fillStyle = COLORS.ground;
					ctx.fillRect( tx, ty + 8, TILE_SIZE, TILE_SIZE - 8 );
				} else {
					ctx.fillStyle = COLORS.platformTop;
					ctx.fillRect( tx, ty, TILE_SIZE, 6 );
					ctx.fillStyle = COLORS.platform;
					ctx.fillRect( tx, ty + 6, TILE_SIZE, TILE_SIZE - 6 );
				}
			}
		}
	}
}

function drawWapuu( ctx: CanvasRenderingContext2D, p: Player, cameraX: number ) {
	const blink = p.invincibleTimer > 0 && Math.floor( p.invincibleTimer / 4 ) % 2 === 0;
	if ( blink ) return;

	const sx = Math.round( p.x - cameraX );
	const sy = Math.floor( p.y );
	const isIdle = p.vx === 0;
	const sp = getSprites();
	const { img, ready } = isIdle ? sp.wapuuIdle : sp.wapuu;
	const frame = isIdle ? 0 : p.animFrame % 4;
	// Draw sprite at 32×32, bottom-aligned to hitbox, horizontally centered
	const dw = 32;
	const dh = 32;
	const dx = sx + ( p.w - dw ) / 2;
	const dy = sy + p.h - dh;

	ctx.save();
	if ( ! p.facingRight ) {
		ctx.translate( dx + dw / 2, 0 );
		ctx.scale( -1, 1 );
		ctx.translate( -( dx + dw / 2 ), 0 );
	}

	if ( ready ) {
		ctx.drawImage( img, frame * 32, 0, 32, 32, dx, dy, dw, dh );
	} else {
		// Fallback procedural
		const x = sx;
		const y = sy;
		ctx.fillStyle = COLORS.wapuuBody;
		ctx.beginPath();
		ctx.roundRect( x + 4, y + 12, 20, 16, 4 );
		ctx.fill();
		ctx.fillStyle = COLORS.wapuuBelly;
		ctx.beginPath();
		ctx.ellipse( x + 14, y + 20, 7, 6, 0, 0, Math.PI * 2 );
		ctx.fill();
		ctx.fillStyle = COLORS.wapuuBody;
		ctx.beginPath();
		ctx.roundRect( x + 3, y + 1, 22, 18, 8 );
		ctx.fill();
		ctx.fillStyle = COLORS.wapuuEar;
		ctx.beginPath();
		ctx.ellipse( x + 5, y + 5, 4, 5, -0.4, 0, Math.PI * 2 );
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse( x + 23, y + 5, 4, 5, 0.4, 0, Math.PI * 2 );
		ctx.fill();
		ctx.fillStyle = COLORS.wapuuHat;
		ctx.beginPath();
		ctx.roundRect( x + 3, y - 3, 22, 9, [ 4, 4, 0, 0 ] );
		ctx.fill();
		ctx.fillRect( x + 1, y + 5, 26, 4 );
		ctx.fillStyle = COLORS.wapuuEye;
		ctx.beginPath();
		ctx.ellipse( x + 10, y + 10, 3, 3.5, 0, 0, Math.PI * 2 );
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse( x + 20, y + 10, 3, 3.5, 0, 0, Math.PI * 2 );
		ctx.fill();
		ctx.fillStyle = '#000';
		ctx.beginPath();
		ctx.ellipse( x + 11, y + 11, 1.5, 1.5, 0, 0, Math.PI * 2 );
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse( x + 21, y + 11, 1.5, 1.5, 0, 0, Math.PI * 2 );
		ctx.fill();
		const legOffset = p.state === 'run' ? Math.sin( p.animFrame * 0.8 ) * 4 : 0;
		ctx.fillStyle = COLORS.wapuuPaw;
		ctx.beginPath();
		ctx.ellipse( x + 8, y + 28 + legOffset, 4, 3, 0, 0, Math.PI * 2 );
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse( x + 20, y + 28 - legOffset, 4, 3, 0, 0, Math.PI * 2 );
		ctx.fill();
	}

	ctx.restore();
}

const BLOCK_SPRITE_W = 32;
const BLOCK_SPRITE_H = 32;
const MGUY_SPRITE_W = 32;
const MGUY_SPRITE_H = 32;

function drawBlock( ctx: CanvasRenderingContext2D, e: Enemy, cameraX: number ) {
	const hx = Math.round( e.x - cameraX );
	const hy = Math.round( e.y );
	// Center sprite over hitbox, bottom-aligned
	const dx = hx + ( e.w - BLOCK_SPRITE_W ) / 2;
	const dy = hy + e.h - BLOCK_SPRITE_H;
	const { img, ready } = getSprites().gutenberg;
	const frame = e.animFrame % 4;
	if ( ready ) {
		ctx.save();
		if ( e.vx < 0 ) {
			ctx.translate( dx + BLOCK_SPRITE_W / 2, 0 );
			ctx.scale( -1, 1 );
			ctx.translate( -( dx + BLOCK_SPRITE_W / 2 ), 0 );
		}
		ctx.drawImage( img, frame * 32, 0, 32, 32, dx, dy, BLOCK_SPRITE_W, BLOCK_SPRITE_H );
		ctx.restore();
		return;
	}
	// Fallback
	const bob = Math.sin( e.animFrame * 0.4 ) * 2;
	ctx.fillStyle = '#1e1e1e';
	ctx.beginPath();
	ctx.roundRect( hx + 2, hy + bob, e.w - 4, e.h - 2, 5 );
	ctx.fill();
	ctx.fillStyle = '#fff';
	ctx.beginPath();
	ctx.arc( hx + e.w / 2, hy + e.h / 2 + bob, 8, 0, Math.PI * 2 );
	ctx.fill();
	ctx.fillStyle = '#1e1e1e';
	ctx.font = 'bold 11px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( 'G', hx + e.w / 2, hy + e.h / 2 + bob + 1 );
	ctx.fillStyle = '#ff4444';
	ctx.fillRect( hx + 6, hy + 5 + bob, 4, 3 );
	ctx.fillRect( hx + 18, hy + 5 + bob, 4, 3 );
}

function drawMguy( ctx: CanvasRenderingContext2D, e: Enemy, cameraX: number ) {
	const hx = Math.round( e.x - cameraX );
	const hy = Math.round( e.y );
	const flash = e.hurtTimer > 0 && Math.floor( e.hurtTimer / 4 ) % 2 === 0;
	if ( flash ) return;

	// Center sprite over hitbox, bottom-aligned
	const dx = hx + ( e.w - MGUY_SPRITE_W ) / 2;
	const dy = hy + e.h - MGUY_SPRITE_H;

	const { img, ready } = getSprites().mguy;
	const frame = e.animFrame % 4;

	ctx.save();
	if ( e.vx < 0 ) {
		ctx.translate( dx + MGUY_SPRITE_W / 2, 0 );
		ctx.scale( -1, 1 );
		ctx.translate( -( dx + MGUY_SPRITE_W / 2 ), 0 );
	}
	if ( ready ) {
		ctx.drawImage( img, frame * 32, 0, 32, 32, dx, dy, MGUY_SPRITE_W, MGUY_SPRITE_H );
	} else {
		// Fallback procedural
		const legSwing = Math.sin( e.animFrame * 0.6 ) * 3;
		ctx.fillStyle = '#222244';
		ctx.fillRect( hx + 8, hy + 26, 7, 12 + legSwing );
		ctx.fillRect( hx + 17, hy + 26, 7, 12 - legSwing );
		ctx.beginPath();
		ctx.roundRect( hx + 5, hy + 14, e.w - 10, 16, 3 );
		ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.fillRect( hx + 13, hy + 15, 6, 10 );
		ctx.fillStyle = '#cc2222';
		ctx.fillRect( hx + 15, hy + 15, 2, 9 );
		ctx.fillStyle = '#c8956c';
		ctx.beginPath();
		ctx.roundRect( hx + 7, hy + 2, 18, 16, 6 );
		ctx.fill();
		ctx.fillStyle = '#1a1a1a';
		ctx.beginPath();
		ctx.roundRect( hx + 7, hy + 2, 18, 7, [ 6, 6, 0, 0 ] );
		ctx.fill();
	}
	ctx.restore();

	// Health pips drawn after restore (screen-space, not flipped)
	ctx.font = 'bold 10px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	if ( e.health > 1 ) {
		ctx.fillStyle = '#f5a623';
		ctx.fillText( '❤❤', hx + e.w / 2, hy - 6 );
	} else {
		ctx.fillStyle = '#ff4444';
		ctx.fillText( '❤', hx + e.w / 2, hy - 6 );
	}
}

function drawEnemy( ctx: CanvasRenderingContext2D, e: Enemy, cameraX: number ) {
	if ( e.type === 'mguy' ) {
		drawMguy( ctx, e, cameraX );
	} else {
		drawBlock( ctx, e, cameraX );
	}
}

function drawCollectible( ctx: CanvasRenderingContext2D, c: Collectible, cameraX: number ) {
	const x = Math.round( c.x - cameraX );
	const bob = Math.sin( c.animFrame * 0.05 ) * 3;
	const y = Math.round( c.y ) + bob;
	const { img, ready } = getSprites().coin;
	if ( ready ) {
		ctx.drawImage( img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, c.w, c.h );
	} else {
		// Fallback
		const r = c.w / 2;
		ctx.fillStyle = COLORS.collectible;
		ctx.beginPath();
		ctx.arc( x + r, y + r, r, 0, Math.PI * 2 );
		ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.font = `bold ${ Math.round( r * 1.2 ) }px monospace`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText( 'W', x + r, y + r + 1 );
	}
}

function drawFlag( ctx: CanvasRenderingContext2D, flag: Flag, cameraX: number ) {
	const x = Math.round( flag.x - cameraX );
	const y = Math.round( flag.y );
	const { img, ready } = getSprites().flag;
	if ( ready ) {
		ctx.drawImage( img, 0, 0, 32, 64, x, y, flag.w, flag.h );
		return;
	}
	// Fallback procedural
	ctx.fillStyle = COLORS.flagPole;
	ctx.fillRect( x + 14, y, 4, flag.h );
	const wave = Math.sin( flag.animFrame * 0.05 ) * 3;
	ctx.fillStyle = COLORS.flagBanner;
	ctx.beginPath();
	ctx.moveTo( x + 18, y + 4 );
	ctx.lineTo( x + 18 + 16 + wave, y + 10 );
	ctx.lineTo( x + 18, y + 18 );
	ctx.closePath();
	ctx.fill();
}

function strokeText(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	fillColor: string
) {
	ctx.strokeStyle = '#000';
	ctx.lineWidth = 3;
	ctx.lineJoin = 'round';
	ctx.strokeText( text, x, y );
	ctx.fillStyle = fillColor;
	ctx.fillText( text, x, y );
}

function drawHud(
	ctx: CanvasRenderingContext2D,
	score: number,
	lives: number,
	timeLeft: number,
	w: number
) {
	ctx.font = 'bold 16px monospace';
	ctx.textBaseline = 'middle';

	// Hearts
	ctx.textAlign = 'left';
	const hearts = Array.from( { length: Math.max( 0, lives ) }, () => '♥' ).join( ' ' );
	strokeText( ctx, hearts, 10, 14, '#ff4444' );

	// Timer
	ctx.textAlign = 'center';
	const timerColor = timeLeft <= 10 ? '#ff4444' : timeLeft <= 30 ? '#f5a623' : COLORS.hudText;
	strokeText( ctx, `⏱ ${ timeLeft }s`, w / 2, 14, timerColor );

	// Score
	ctx.textAlign = 'right';
	strokeText( ctx, `${ score } pts`, w - 10, 14, COLORS.hudText );
}

function drawHitboxes(
	ctx: CanvasRenderingContext2D,
	player: Player,
	enemies: Enemy[],
	collectibles: Collectible[],
	flag: Flag | null,
	cameraX: number
) {
	ctx.save();
	ctx.globalAlpha = 0.5;
	ctx.lineWidth = 1;

	// Player — green
	ctx.strokeStyle = '#00ff00';
	ctx.strokeRect( player.x - cameraX, player.y, player.w, player.h );

	// Enemies — red
	ctx.strokeStyle = '#ff0000';
	for ( const e of enemies ) {
		if ( e.alive ) ctx.strokeRect( e.x - cameraX, e.y, e.w, e.h );
	}

	// Collectibles — yellow
	ctx.strokeStyle = '#ffff00';
	for ( const c of collectibles ) {
		if ( ! c.collected ) ctx.strokeRect( c.x - cameraX, c.y, c.w, c.h );
	}

	// Flag — cyan
	if ( flag ) {
		ctx.strokeStyle = '#00ffff';
		ctx.strokeRect( flag.x - cameraX, flag.y, flag.w, flag.h );
	}

	ctx.restore();
}

export function renderGame(
	ctx: CanvasRenderingContext2D,
	state: {
		player: Player;
		enemies: Enemy[];
		collectibles: Collectible[];
		flag: Flag | null;
		score: number;
		cameraX: number;
		timeLeft: number;
	},
	w: number,
	h: number,
	debug = false
) {
	const { player, enemies, collectibles, flag, score, timeLeft } = state;
	const cameraX = Math.floor( state.cameraX );

	waterTick++;
	WIN_LINK.y = -1;
	WIN_LINK.h = 0;
	ctx.clearRect( 0, 0, w, h );
	drawBackground( ctx, cameraX, w, h );
	drawTiles( ctx, cameraX, w, h );
	drawWater( ctx, cameraX, w, h );

	for ( const c of collectibles ) {
		if ( ! c.collected ) drawCollectible( ctx, c, cameraX );
	}
	if ( flag ) drawFlag( ctx, flag, cameraX );
	for ( const e of enemies ) {
		if ( e.alive ) drawEnemy( ctx, e, cameraX );
	}

	drawWapuu( ctx, player, cameraX );
	if ( debug ) drawHitboxes( ctx, player, enemies, collectibles, flag, cameraX );
	drawHud( ctx, score, player.lives, timeLeft, w );
}

export function renderStartScreen(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	startTimer: number
) {
	ctx.fillStyle = 'rgba(0,0,0,0.7)';
	ctx.fillRect( 0, 0, w, h );
	ctx.fillStyle = '#f5a623';
	ctx.font = 'bold 28px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( 'Wapuu World', w / 2, h / 2 - 44 );
	ctx.fillStyle = '#fff';
	ctx.font = '14px monospace';
	ctx.fillText( 'Collect coins, stomp enemies, reach the flag!', w / 2, h / 2 - 8 );
	ctx.fillStyle = '#cce8f4';
	ctx.font = '13px monospace';
	ctx.fillText( 'Arrow keys / WASD · Space to jump', w / 2, h / 2 + 16 );
	const seconds = Math.ceil( startTimer / 60 );
	ctx.fillStyle = '#fff';
	ctx.font = '16px monospace';
	ctx.fillText( `Press Enter or Space to start (${ seconds }s)`, w / 2, h / 2 + 50 );
}

export function renderDeathScreen( ctx: CanvasRenderingContext2D, w: number, h: number ) {
	ctx.fillStyle = 'rgba(0,0,0,0.7)';
	ctx.fillRect( 0, 0, w, h );
	ctx.fillStyle = '#ff4444';
	ctx.font = 'bold 28px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( 'GAME OVER', w / 2, h / 2 - 20 );
	ctx.fillStyle = '#fff';
	ctx.font = '16px monospace';
	ctx.fillText( 'Press Enter or Space to retry', w / 2, h / 2 + 16 );
}

export const WIN_LINK = { url: 'https://wapuu.studio', y: -1, h: 0 };

export function renderWinScreen(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	score: number
) {
	ctx.fillStyle = 'rgba(0,0,0,0.7)';
	ctx.fillRect( 0, 0, w, h );
	ctx.fillStyle = '#f5a623';
	ctx.font = 'bold 28px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( '🎉 YOU WIN! 🎉', w / 2, h / 2 - 44 );
	ctx.fillStyle = '#fff';
	ctx.font = '18px monospace';
	ctx.fillText( `Score: ${ score }`, w / 2, h / 2 - 10 );
	ctx.font = '13px monospace';
	ctx.fillText( 'Press Enter or Space to play again', w / 2, h / 2 + 18 );
	ctx.fillStyle = '#aad4f5';
	ctx.font = '12px monospace';
	ctx.fillText( 'Want your own Wapuu? Visit', w / 2, h / 2 + 46 );
	// Underlined link
	ctx.fillStyle = '#f5a623';
	ctx.font = 'bold 13px monospace';
	const linkY = h / 2 + 66;
	ctx.fillText( 'wapuu.studio', w / 2, linkY );
	const linkW = ctx.measureText( 'wapuu.studio' ).width;
	ctx.fillRect( w / 2 - linkW / 2, linkY + 8, linkW, 1 );
	WIN_LINK.y = linkY - 10;
	WIN_LINK.h = 22;
}
