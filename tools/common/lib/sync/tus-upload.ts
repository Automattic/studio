import fs from 'fs';
import nodePath from 'path';
import { Upload } from 'tus-js-client';

/**
 * Decide whether a failed TUS request should be retried, based on the HTTP
 * status of the original response.
 *
 * - 5xx and network errors (status 0): transient, keep retrying.
 * - 4xx: client errors that won't succeed on retry, so stop — most importantly
 *   413 (archive exceeds the server's ARCHIVE_UPLOAD_MAX_SIZE) and 403.
 *   Exceptions are statuses the resumable protocol uses transiently: 423
 *   (Locked) and 409 (Conflict during resume), which we keep retrying.
 */
export function shouldRetryTusStatus(status: number): boolean {
	if (status >= 400 && status < 500) {
		// 409 Conflict / 423 Locked can occur transiently during resumable
		// uploads; everything else in 4xx (403, 413, …) is terminal.
		return status === 409 || status === 423;
	}
	return true;
}

export type TusUploadOptions = {
	token: string;
	remoteSiteId: number;
	archivePath: string;
	onProgress?: (percent: number) => void;
	onNetworkPause?: (error: string) => void;
	onResume?: () => void;
};

export function createTusUpload(options: TusUploadOptions): {
	promise: Promise<string>;
	abort: () => void;
} {
	const { token, remoteSiteId, archivePath, onProgress, onNetworkPause, onResume } = options;

	let rejectFn: (error: Error) => void;
	let uploadInstance: Upload | null = null;
	let isAborted = false;
	let hasUploadStarted = false;
	let isNetworkPaused = false;

	const abort = () => {
		isAborted = true;
		if (uploadInstance) {
			void uploadInstance.abort();
		}
		rejectFn?.(new Error('Upload aborted'));
	};

	const promise = (async () => {
		const file = fs.createReadStream(archivePath);
		const fileSize = fs.statSync(archivePath).size;
		const filename = nodePath.basename(archivePath);

		return new Promise<string>((resolve, reject) => {
			rejectFn = reject;

			if (isAborted) {
				file.destroy();
				reject(new Error('Upload aborted'));
				return;
			}

			const upload = new Upload(file, {
				endpoint: `https://public-api.wordpress.com/rest/v1.1/studio-file-uploads/${remoteSiteId}`,
				chunkSize: 500000,
				retryDelays: [0, 1000, 3000, 5000, 10000, 25000],
				overridePatchMethod: true,
				removeFingerprintOnSuccess: true,
				storeFingerprintForResuming: true,
				headers: {
					Authorization: `Bearer ${token}`,
				},
				metadata: {
					filename,
					filetype: 'application/gzip',
				},
				uploadSize: fileSize,
				onBeforeRequest: (req) => {
					if (req.getMethod() === 'HEAD') {
						// @ts-expect-error Override method to get response headers
						req._method = 'GET';
						req.setHeader('X-HTTP-Method-Override', 'HEAD');
					}
				},
				onError: (error) => {
					file.destroy();
					reject(error);
				},
				onProgress: (bytesSent: number, bytesTotal: number) => {
					if (isNetworkPaused) {
						isNetworkPaused = false;
						onResume?.();
					}

					if (!hasUploadStarted) {
						hasUploadStarted = true;
					}

					if (onProgress && bytesTotal > 0) {
						onProgress((bytesSent / bytesTotal) * 100);
					}
				},
				onSuccess: (payload) => {
					file.destroy();
					if (!payload.lastResponse) {
						reject(new Error('Upload completed but no response received'));
						return;
					}

					const attachmentId = payload.lastResponse.getHeader('x-studio-file-upload-media-id');
					if (attachmentId) {
						resolve(attachmentId);
					} else {
						reject(new Error('Upload completed but attachment ID not found'));
					}
				},
				onShouldRetry: (error) => {
					if (isAborted) {
						return false;
					}

					if (hasUploadStarted) {
						isNetworkPaused = true;
						onNetworkPause?.(error.message);
					}

					const status = error.originalResponse ? error.originalResponse.getStatus() : 0;
					return shouldRetryTusStatus(status);
				},
			});

			uploadInstance = upload;
			upload.start();
		});
	})();

	return { promise, abort };
}
