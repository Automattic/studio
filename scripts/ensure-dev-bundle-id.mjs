#!/usr/bin/env node

// Git worktrees allow you to have multiple working directories associated with a single repo,
// enabling you to work on different branches simultaneously. This is especially useful for AI
// agent threads. It doesn't work well with Electron's protocol client handler logic on macOS,
// though. That's because macOS uses the Info.plist bundle identifier to determine which binary
// should open the URL, and if you've started Studio in multiple workspaces, there are multiple
// potential `wp-studio://` binaries. This script fixes the problem by patching
// `node_modules/electron/dist/Electron.app/Contents/Info.plist` to contain a unique bundle
// identifier for each workspace. Runs as a `prestart` before electron-vite dev spawns Electron.

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
console.log( `Patched Electron.app bundle ID -> ${ uniqueId }` );
