import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import zlib from "zlib";
import * as tar from "tar";
import AdmZip from "adm-zip";
import { FileInput } from "../types";

export interface IBackupHandler {
  listFiles(file: FileInput): Promise<string[]>;
  extractFiles(file: FileInput, extractDir: string): Promise<void>;
}

export class BackupHandler implements IBackupHandler {
  async listFiles(file: FileInput): Promise<string[]> {
    const ext = path.extname(file.path).toLowerCase();
    if (file.type === "application/gzip" && ext === ".gz") {
      console.log("listing tar files");
      return this.listTarGzContents(file.path);
    } else if (file.type === "application/zip" && ext === ".zip") {
      return this.listZipContents(file.path);
    } else {
      throw new Error(
        "Unsupported file format. Only .gz and .zip files are supported.",
      );
    }
  }

  private async listTarGzContents(filePath: string): Promise<string[]> {
    const files: string[] = [];
    await tar.t({
      file: filePath,
      onReadEntry: (entry) => files.push(entry.path),
    });
    return files;
  }

  private listZipContents(filePath: string): string[] {
    const zip = new AdmZip(filePath);
    return zip.getEntries().map((entry) => entry.entryName);
  }

  async extractFiles(file: FileInput, extractDir: string): Promise<void> {
    await fsPromises.mkdir(extractDir, { recursive: true });

    const ext = path.extname(file.path).toLowerCase();
    if (file.type === "application/gzip" && ext === ".gz") {
      await this.extractTarGz(file.path, extractDir);
    } else if (file.type === "application/zip" && ext === ".zip") {
      await this.extractZip(file.path, extractDir);
    }
  }

  private async extractTarGz(
    filePath: string,
    extractDir: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(zlib.createGunzip())
        .pipe(tar.extract({ cwd: extractDir }))
        .on("finish", resolve)
        .on("error", reject);
    });
  }

  private extractZip(filePath: string, extractDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const zip = new AdmZip(filePath);
      zip.extractAllToAsync(extractDir, true, undefined, (error?: Error) => {
        if (error) {
          reject(error);
        }
        resolve();
      });
    });
  }
}

