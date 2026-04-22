#!/usr/bin/env node
// Give each dev workspace's unpackaged Electron.app a unique CFBundleIdentifier
// so wp-studio:// deep links don't collide across Conductor worktrees in Launch
// Services. Runs as a `prestart` before electron-vite dev spawns Electron —
// doing this inside the main process forces `app.relaunch()`, which doesn't
// survive electron-vite dev (the child loses ELECTRON_RENDERER_URL and boots
// to an empty window). Idempotent; re-patches after `npm install` resets the
// plist. macOS-only; no-op elsewhere.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

if ( process.platform !== 'darwin' ) {
	process.exit( 0 );
}

const electronBinary = createRequire( import.meta.url )( 'electron' );
const electronAppPath = path.resolve( electronBinary, '..', '..', '..' );
const infoPlist = path.join( electronAppPath, 'Contents', 'Info.plist' );
const plistBuddy = '/usr/libexec/PlistBuddy';
const lsregister =
	'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const currentId = execFileSync( plistBuddy, [ '-c', 'Print :CFBundleIdentifier', infoPlist ], {
	encoding: 'utf8',
} ).trim();

if ( currentId !== 'com.github.Electron' ) {
	process.exit( 0 );
}

const uniqueId = `com.studio.dev.${ createHash( 'sha1' )
	.update( electronAppPath )
	.digest( 'hex' )
	.slice( 0, 12 ) }`;

execFileSync( plistBuddy, [ '-c', `Set :CFBundleIdentifier ${ uniqueId }`, infoPlist ] );
execFileSync( lsregister, [ '-f', electronAppPath ] );
console.log( `Patched Electron.app bundle ID -> ${ uniqueId }` );
