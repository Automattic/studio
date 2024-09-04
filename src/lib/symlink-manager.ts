import fs, { FileChangeInfo } from 'node:fs/promises';
import path from 'path';
import { createNodeFsMountHandler } from '@php-wasm/node';
import { PHP, UnmountFunction } from '@php-wasm/universal';
import { pathExists } from './fs-utils';

type MountedTarget = {
	preExisting: boolean;
	referenceCount: number;
	unmountFunction?: UnmountFunction | null;
};

/**
 * Manages symlinks within a PHP WebAssembly runtime environment. In this setup,
 * a site's directory from the host system is mounted inside the WebAssembly runtime.
 * However, symlink targets are not automatically mounted, leaving symlinks pointing to nothing.
 * This class resolves that issue by mounting the actual targets of symlinks.
 *
 * Key functionalities:
 * 1. Scans for symlinks in the mounted directory
 * 2. Mounts symlink targets in the WebAssembly runtime
 * 3. Manages reference counting for mounted targets
 * 4. Watches for file system changes and updates mounts accordingly
 *
 * The class ensures that symlinks within the PHP WebAssembly environment correctly
 * reference their targets, maintaining the integrity of the file system structure
 * across the host and WebAssembly boundary.
 */
export class SymlinkManager {
	private symlinks: Map< string, string >; // Store relative path of symlink and its vfs realpath
	private mountedTargets: Map< string, MountedTarget >; // Store the target of the symlink and its reference count
	private php: PHP;
	readonly projectPath: string;
	private watcher?: AsyncIterable< FileChangeInfo< string > > | null;
	private watcherAbortController?: AbortController | null;

	/**
	 * Create a new symlink manager.
	 * @param php
	 * @param projectPath
	 *
	 */
	constructor( php: PHP, projectPath: string ) {
		this.symlinks = new Map< string, string >();
		this.mountedTargets = new Map< string, MountedTarget >();
		this.php = php;
		this.projectPath = projectPath;
	}

	/**
	 * Scan the project path for symlinks and mount their targets in the PHP runtime.
	 */
	async scanAndCreateSymlinks() {
		for await ( const symlink of this.collectSymlinks( this.projectPath ) ) {
			const relativePath = path.relative( this.projectPath, symlink );
			await this.addSymlink( relativePath );
		}
	}

	/**
	 * Watches the project path for changes and update symlinks accordingly.
	 */
	startWatching() {
		this.watcherAbortController = new AbortController();
		const { signal } = this.watcherAbortController;
		this.watcher = fs.watch( this.projectPath, { recursive: true, signal } );

		return new Promise< void >( ( resolve, reject ) => {
			( async () => {
				try {
					if ( ! this.watcher ) {
						return resolve();
					}
					for await ( const change of this.watcher ) {
						await this.handleFileChange( change );
					}
					resolve();
				} catch ( err ) {
					// AbortError is expected when the watcher is stopped intentionally
					if ( err instanceof Error && err.name === 'AbortError' ) {
						return resolve();
					}
					reject( err );
				}
			} )();
		} );
	}

	/**
	 * Stop watching the project path for changes.
	 */
	async stopWatching() {
		if ( ! this.watcherAbortController ) {
			return;
		}
		this.watcherAbortController.abort( 'Watcher stopped' );
		this.watcher = null;
		this.watcherAbortController = null;
	}

	/**
	 * Handle a file change event.
	 * @param change
	 */
	private async handleFileChange( change: FileChangeInfo< string > ) {
		const { filename } = change;

		if ( filename === null ) {
			return;
		}

		// Check if the file exists
		const fullPath = path.join( this.projectPath, filename );

		const fileExistsOnHost = await pathExists( fullPath );

		// If the file does not exist, it was deleted. Check if it was a symlink and remove it.
		if ( ! fileExistsOnHost && this.symlinks.has( filename ) ) {
			await this.deleteMountedTarget( filename );
		}

		if ( ! fileExistsOnHost ) {
			return;
		}

		const stat = await fs.lstat( fullPath );
		if ( ! stat.isSymbolicLink() ) {
			return;
		}

		await this.addSymlink( filename );
	}

	/**
	 * Add a symlink to the PHP runtime by mounting the target path.
	 * @param filename
	 */
	private async addSymlink( filename: string ) {
		const fullPath = path.join( this.projectPath, filename );
		const target = await fs.realpath( fullPath );

		if ( ! this.php.requestHandler ) {
			throw new Error( 'Request handler is not set' );
		}

		const vfsPath = path.posix.join( this.php.requestHandler.documentRoot, filename );

		// Double check to ensure the symlink exists
		if ( ! this.php.fileExists( vfsPath ) ) {
			return;
		}

		// Get the realpath of the symlink within the PHP runtime.
		const vfsTarget = this.php.readlink( vfsPath );
		this.symlinks.set( filename, vfsTarget );

		await this.mountTarget( vfsTarget, target );
	}

	/**
	 * Mount a target path in the PHP runtime.
	 * @param vfsTarget
	 * @param hostTarget
	 * @private
	 */
	private async mountTarget( vfsTarget: string, hostTarget: string ) {
		let mountInfo = this.mountedTargets.get( vfsTarget );

		if ( typeof mountInfo === 'undefined' ) {
			mountInfo = {
				preExisting: this.php.fileExists( vfsTarget ),
				referenceCount: 0,
				unmountFunction: null,
			};
			this.mountedTargets.set( vfsTarget, mountInfo );
		}

		mountInfo.referenceCount++;

		if ( mountInfo.preExisting || mountInfo.unmountFunction !== null ) {
			return;
		}

		this.php.mkdir( vfsTarget );
		mountInfo.unmountFunction = await this.php.mount(
			vfsTarget,
			createNodeFsMountHandler( hostTarget )
		);
	}

	/**
	 * Delete a symlink from the PHP runtime.
	 *
	 * @param filename
	 */
	private async deleteMountedTarget( filename: string ) {
		const vfsTarget = this.symlinks.get( filename );

		if ( vfsTarget === undefined ) {
			return;
		}

		// Get the mount info for the target
		const mountInfo = this.mountedTargets.get( vfsTarget );
		if ( typeof mountInfo === 'undefined' ) {
			return;
		}

		mountInfo.referenceCount--;

		// We can delete the symlink now as it is no longer needed.
		this.symlinks.delete( filename );

		// If the reference count is 0 and the unmount function is set, we can unmount the target
		if ( mountInfo.referenceCount === 0 && mountInfo.unmountFunction && ! mountInfo.preExisting ) {
			await mountInfo.unmountFunction();

			// After unmounting, clear the mount target
			if ( this.php.isFile( vfsTarget ) ) {
				this.php.unlink( vfsTarget );
			}

			if ( this.php.isDir( vfsTarget ) ) {
				this.php.rmdir( vfsTarget );
			}

			this.mountedTargets.delete( vfsTarget );
		}
	}

	/**
	 * Collect all symlinks in a directory.
	 * @param dir
	 * @private
	 */
	private async *collectSymlinks( dir: string ): AsyncGenerator< string > {
		const files = await fs.readdir( dir );
		for ( const file of files ) {
			const filePath = path.join( dir, file );
			const stats = await fs.lstat( filePath );
			if ( stats.isSymbolicLink() ) {
				yield filePath;
			} else if ( stats.isDirectory() ) {
				yield* this.collectSymlinks( filePath );
			}
		}
	}
}
