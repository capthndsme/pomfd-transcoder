import { unlink } from 'fs/promises';
import { FilePtr } from '../types/FilePtr.js';
import ffmpeg, { FfprobeData } from 'fluent-ffmpeg';
import extractFrames from 'ffmpeg-extract-frames';
import sharp from 'sharp';
import { encode } from 'blurhash';
import { randomUUID } from 'crypto';
 

class CompressorService {
  /**
   * Wraps an ffmpeg command in a Promise for use with async/await.
   * @param command The fluent-ffmpeg command to execute.
   * @param passName A descriptive name for the pass for logging purposes.
   * @returns A promise that resolves on success and rejects on error.
   */
  private runFfmpegCommand(command: ffmpeg.FfmpegCommand, passName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      command
        .on('end', () => {
          console.log(`✅ FFmpeg ${passName} completed successfully.`);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`❌ Error during FFmpeg ${passName}:`, err.message);
          console.error('FFmpeg stdout:', stdout);
          console.error('FFmpeg stderr:', stderr);
          reject(err);
        })
        .run();
    });
  }

  async ffprobeAsync(ptr: FilePtr): Promise<FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(ptr.fileLocation, (err, data) => {
        if (err) {
          reject(new Error(err));
        } else {
          resolve(data);
        }
      });
    });
  }

  async getImageDim(ptr: FilePtr) {
    const image = sharp(ptr.fileLocation, { failOn: 'none' });
    const meta = await image.metadata();

    const orientation = meta.orientation ?? 0;

    if (meta.orientation) {
      // Adjust dimensions based on the orientation value
      switch (meta.orientation) {
        case 6: // 90 degrees
        case 8: // 270 degrees
          ;[meta.width, meta.height] = [meta.height, meta.width];
          break;
        case 3: // 180 degrees
          // No change in dimensions
          break;
        default:
          // Normal orientation, no change needed
          break;
      }
    }

    return { width: meta.width ?? 0, height: meta.height ?? 0, orientation };
  }

  async createPhotoThumbnail(inputFilePtr: FilePtr, outputFilePtr: FilePtr, maxDimension = 900) {
    try {
      const pipeline = sharp(inputFilePtr.fileLocation, { failOn: 'none' });

      const metadata = await pipeline.metadata();
      outputFilePtr.extraInternalInfo = {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
      };
      inputFilePtr.fileInfo.itemWidth = metadata.width;
      inputFilePtr.fileInfo.itemHeight = metadata.height;

      await pipeline
        .rotate()
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toFile(outputFilePtr.fileLocation);

      const tinyThumbBuffer = await sharp(outputFilePtr.fileLocation)
        .raw()
        .ensureAlpha()
        .resize(32, 32, { fit: 'inside' })
        .toBuffer({ resolveWithObject: true });

      const blurHashEncodement = encode(
        new Uint8ClampedArray(tinyThumbBuffer.data),
        tinyThumbBuffer.info.width,
        tinyThumbBuffer.info.height,
        4,
        4
      );

      outputFilePtr.fileInfo.previewBlurHash = blurHashEncodement;

      return outputFilePtr;
    } catch (error) {
      console.error('❌ Failed to create photo thumbnail:', error);
      throw error;
    }
  }

  async mkThumbnail(filePtr: FilePtr): Promise<FilePtr> {
    const thumbPath = `${filePtr.fileLocation}__thumbnail__.jpg`;
    const newPtr: FilePtr = {
      ...filePtr,
      extraInternalInfo: filePtr.extraInternalInfo,
      fileLocation: thumbPath,
    };
    if (filePtr.fileInfo.fileType === 'VIDEO') {
      const loc = `${filePtr.fileLocation}__thumbnail__preproc.jpg`;
      await extractFrames({
        input: filePtr.fileLocation,
        output: loc,
      });
      await this.createPhotoThumbnail({ ...filePtr, fileLocation: loc }, newPtr);
      await unlink(loc);
      console.log('Made video thumbnail!');
      return newPtr;
    } else if (filePtr.fileInfo.fileType === 'IMAGE') {
      await this.createPhotoThumbnail(filePtr, newPtr);
      console.log('Made image thumbnail!');
      return newPtr;
    } else {
      throw new Error('unsupported file type ' + filePtr.fileInfo.fileType);
    }
  }

  async mkScaledVidPhoto(
    largestHeight: '480' | '720' | '1080',
    filePtr: FilePtr
  ): Promise<FilePtr> {
    if (filePtr.fileInfo.fileType === 'IMAGE') {
      const outputFileName = `${filePtr.fileLocation}_${largestHeight}p.jpeg`;
      const newPtr: FilePtr = {
        ...filePtr,
        extraInternalInfo: filePtr.extraInternalInfo,
        fileLocation: outputFileName,
      };
      await this.createPhotoThumbnail(filePtr, newPtr, parseInt(largestHeight));
      console.log('Made image scaled version!');
      return newPtr;
    }
    
    if (filePtr.fileInfo.fileType !== 'VIDEO') {
        throw new Error('unsupported file type ' + filePtr.fileInfo.fileType);
    }

    // --- Video Transcoding Logic ---
    const outputFileName = `${filePtr.fileLocation}_${largestHeight}p.mp4`;
    const bitrate = { '480': '3M', '720': '5M', '1080': '8M' }[largestHeight];

    // Use a unique ID for pass log files to prevent conflicts during concurrent runs
    const passLogFile = `${filePtr.fileLocation}_${randomUUID()}.log`;
    const pass1Output = `${outputFileName}.pass1.tmp.mp4`;

    try {
      // --- PASS 1 ---
      // Gathers statistics about the video for the second pass.
      const pass1Command = ffmpeg(filePtr.fileLocation)
        .inputOptions(['-fflags +genpts'])
        .outputOptions([
          `-vf scale=-2:${largestHeight}`,
          '-c:v libx264',
          '-preset medium',
          '-b:v ' + bitrate,
          '-pass 1',
          `-passlogfile ${passLogFile}`, // Explicitly define log file
          '-an', // No audio needed for the first pass
          '-f mp4',
          '-y' // Overwrite temp file if it exists
        ])
        .output(pass1Output); // Output to a temporary file

      await this.runFfmpegCommand(pass1Command, `pass 1 for ${largestHeight}p`);

      // --- PASS 2 ---
      // The actual encoding using the stats from pass 1.
      const pass2Command = ffmpeg(filePtr.fileLocation)
        .inputOptions(['-fflags +genpts'])
        .outputOptions([
          `-vf scale=-2:${largestHeight}`,
          '-c:v libx264',
          '-preset medium',
          // *** KEY FIX ***: Specify a common pixel format for broad compatibility.
          // This is the most likely fix for the "Invalid argument" error.
          '-pix_fmt yuv420p',
          '-b:v ' + bitrate,
          '-pass 2',
          `-passlogfile ${passLogFile}`, // Use the same log file as pass 1
          '-c:a aac',
          '-b:a 256k',
          '-movflags +faststart', // Optimizes for web streaming
          '-y' // Overwrite final file if it exists
        ])
        .output(outputFileName);

      await this.runFfmpegCommand(pass2Command, `pass 2 for ${largestHeight}p`);
      
      console.log(`✅ Video converted to ${largestHeight}p: ${outputFileName}`);
      return { ...filePtr, fileLocation: outputFileName };

    } catch (error) {
      // Re-throwing the error allows the calling function to handle the failure.
      console.error(`❌ Transcoding to ${largestHeight}p failed.`);
      throw error;
    } finally {
      // --- Cleanup ---
      // Always attempt to clean up temporary files, even if an error occurred.
      console.log('🧹 Cleaning up temporary transcoding files...');
      await unlink(pass1Output).catch(err => console.warn(`Could not delete temp file ${pass1Output}: ${err.message}`));
      await unlink(passLogFile).catch(err => console.warn(`Could not delete log file ${passLogFile}: ${err.message}`));
      await unlink(passLogFile + ".mbtree").catch(err => console.warn(`Could not delete mbtree file ${passLogFile}.mbtree: ${err.message}`));
    }
  }
}

export default new CompressorService();
