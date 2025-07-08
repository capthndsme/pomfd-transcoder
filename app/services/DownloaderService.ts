import FileItem from "#models/file_item";
import { type FilePtr, makeFilePtr } from "../types/FilePtr.js";
import { randomBytes } from "crypto";
import { createWriteStream } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";

class DownloaderService {
  #collectedPointers: FilePtr[] = []
  async downloadFileToPtr(
    url: string,
    fileMeta: FileItem
  ): Promise<FilePtr> {

    // efficiently write the File to the disk directly.
    console.log('url', url)
    const res = await fetch(url)

    if (!res.ok || !res.body) {
      throw new Error(`unexpected response ${res.statusText}`)
    }

    // create tmp file
    const tempDir = tmpdir()
    // Pop and clean the query strings.
    const extractedExtensionFromUrl = url.split('.').pop()?.split('?')[0] || 'tmp'
    const filePath = `${tempDir}/transcoding-file-${Date.now()}-${randomBytes(16).toString('hex')}.${extractedExtensionFromUrl}`

    const writer = createWriteStream(filePath);

    try {
      await pipeline(
        res.body,
        writer
      )
      console.log("Download finished")
      this.#collectedPointers.push(makeFilePtr(filePath, fileMeta))

      return makeFilePtr(filePath, fileMeta)
    } catch (e) {
      // error. try to delete as well
      console.error("Download failed", e)
      unlink(filePath).catch(console.log) // we dont care if it fails
      throw e
    } 
  
  }

  async getCollectedPointers() {
    return this.#collectedPointers
  }

  async shutdown() {
    for (const ptr of this.#collectedPointers) {
      await unlink(ptr.fileLocation).catch(console.warn)
    }
    this.#collectedPointers = []
  
  }

}

export default new DownloaderService()