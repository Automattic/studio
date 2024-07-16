import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { ExportOptions } from "../types";

abstract class BaseExporter {
  constructor(protected options: ExportOptions) {}

  abstract export(): Promise<void>;

  protected async addWordPressFiles(): Promise<void> {
    // Common implementation for adding WordPress files
  }

  protected async exportDatabase(): Promise<void> {
    // Common implementation for exporting database
  }

  protected async addUploads(): Promise<void> {
    // Common implementation for adding uploads
  }

  protected async addPlugins(): Promise<void> {
    // Common implementation for adding plugins
  }

  protected async addThemes(): Promise<void> {
    // Common implementation for adding themes
  }
}

// Zip format exporter
class ZipExporter extends BaseExporter {
  async export(): Promise<void> {
    const output = createWriteStream(this.options.backupPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.pipe(output);

    if (this.options.includes.database) {
      await this.exportDatabase();
      archive.file('database.sql', { name: 'database.sql' });
    }
    await archive.finalize();
  }
}

// Tar.gz format exporter
class TarGzExporter extends BaseExporter {
  async export(): Promise<void> {
    const output = createWriteStream(this.options.backupPath);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: { level: 9 }
    });

    archive.pipe(output);
    await archive.finalize();
  }
}

class ExporterFactory {
  static createExporter(format: string, options: ExportOptions): BaseExporter {
    switch (format.toLowerCase()) {
      case 'zip':
        return new ZipExporter(options);
      case 'tar.gz':
        return new TarGzExporter(options);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }
