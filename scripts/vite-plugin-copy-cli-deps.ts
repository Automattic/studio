/**
 * Vite plugin to copy CLI external dependencies for pnpm compatibility.
 *
 * This plugin handles pnpm's symlinked node_modules structure by:
 * 1. Copying the .pnpm directory (where actual package code lives)
 * 2. Preserving symlinks (not dereferencing them)
 *
 * This creates a self-contained node_modules in the build output where
 * symlinks point to local paths that exist.
 */

import { existsSync, lstatSync, readdirSync, mkdirSync, copyFileSync, symlinkSync, readlinkSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { copySync } from 'fs-extra';
import type { Plugin } from 'vite';

interface CopyCliDepsOptions {
	/** Source node_modules directory (default: 'cli/node_modules') */
	source?: string;
	/** Destination directory relative to outDir (default: 'node_modules') */
	dest?: string;
	/** List of external packages to copy (if not specified, copies all) */
	externals?: string[];
}

/**
 * Detects if pnpm is being used by checking for .pnpm directory
 */
function isPnpm(nodeModulesPath: string): boolean {
	return existsSync(join(nodeModulesPath, '.pnpm'));
}

/**
 * Copies a symlink, preserving it as a symlink
 */
function copySymlink(src: string, dest: string): void {
	const linkTarget = readlinkSync(src);
	const destDir = dirname(dest);
	
	if (!existsSync(destDir)) {
		mkdirSync(destDir, { recursive: true });
	}
	
	// Remove existing file/symlink if it exists
	try {
		const stats = lstatSync(dest);
		if (stats) {
			require('fs').unlinkSync(dest);
		}
	} catch {
		// File doesn't exist, which is fine
	}
	
	symlinkSync(linkTarget, dest);
}

/**
 * Copies directory contents, preserving symlinks
 */
function copyDirPreservingSymlinks(src: string, dest: string): void {
	if (!existsSync(dest)) {
		mkdirSync(dest, { recursive: true });
	}
	
	const entries = readdirSync(src, { withFileTypes: true });
	
	for (const entry of entries) {
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);
		
		if (entry.isSymbolicLink()) {
			copySymlink(srcPath, destPath);
		} else if (entry.isDirectory()) {
			copyDirPreservingSymlinks(srcPath, destPath);
		} else {
			const destDir = dirname(destPath);
			if (!existsSync(destDir)) {
				mkdirSync(destDir, { recursive: true });
			}
			copyFileSync(srcPath, destPath);
		}
	}
}

/**
 * Vite plugin that copies CLI dependencies with pnpm support
 */
export function copyCliDeps(options: CopyCliDepsOptions = {}): Plugin {
	const {
		source = 'cli/node_modules',
		dest = 'node_modules',
	} = options;

	let outDir: string;
	let rootDir: string;

	return {
		name: 'vite-plugin-copy-cli-deps',
		
		configResolved(config) {
			outDir = config.build.outDir;
			rootDir = config.root;
		},

		closeBundle() {
			const sourceDir = resolve(rootDir, source);
			const destDir = resolve(rootDir, outDir, dest);

			if (!existsSync(sourceDir)) {
				console.log(`[copy-cli-deps] Source directory not found: ${sourceDir}`);
				return;
			}

			console.log(`[copy-cli-deps] Copying CLI dependencies from ${sourceDir}`);

			if (isPnpm(sourceDir)) {
				console.log('[copy-cli-deps] Detected pnpm structure - using symlink-preserving copy');
				
				// Step 1: Copy .pnpm directory (contains all actual code)
				const pnpmDir = join(sourceDir, '.pnpm');
				const destPnpmDir = join(destDir, '.pnpm');
				
				console.log('[copy-cli-deps] Copying .pnpm directory...');
				copySync(pnpmDir, destPnpmDir, { dereference: false });
				
				// Step 2: Copy top-level entries (symlinks) preserving them as symlinks
				console.log('[copy-cli-deps] Copying symlinks...');
				const entries = readdirSync(sourceDir, { withFileTypes: true });
				
				for (const entry of entries) {
					if (entry.name === '.pnpm') continue; // Already copied
					
					const srcPath = join(sourceDir, entry.name);
					const destPath = join(destDir, entry.name);
					
					if (entry.isSymbolicLink()) {
						copySymlink(srcPath, destPath);
					} else if (entry.isDirectory()) {
						// For scoped packages like @php-wasm
						copyDirPreservingSymlinks(srcPath, destPath);
					} else {
						copyFileSync(srcPath, destPath);
					}
				}
				
				console.log('[copy-cli-deps] pnpm structure copied successfully');
			} else {
				console.log('[copy-cli-deps] Detected npm structure - using standard copy');
				
				// Standard npm - just copy everything
				copySync(sourceDir, destDir, { dereference: true });
				
				console.log('[copy-cli-deps] npm structure copied successfully');
			}
		},
	};
}

export default copyCliDeps;
