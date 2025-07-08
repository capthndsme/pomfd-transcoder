import FileItem from '#models/file_item'
import { ApiBase } from '../../shared/types/ApiBase.js'

import MainServerAxiosService from './MainServerAxiosService.js'
import DownloaderService from './DownloaderService.js'
import CompressorService from './CompressorService.js'
import { readFile, unlink } from 'fs/promises'
import AxiosWithAuth from './AxiosWithAuth.js'

class TranscodeService {
  #transcodeTotal: number = 0
  #booted = false
  constructor() {
    console.log('TranscodeService has been initialized.')
    this.start()
  }

  public start() {
    console.log('TranscodeService has started.')
    // Add any startup logic here
    if (this.#booted) return

    this.#booted = true
    setTimeout(() => this.loop(), 1000)
  }

  async loop() {
    try {
      await this.syncWork()
    } catch (e) {
      console.warn(`Transcode Loop failed`, e)
    } finally {
      setTimeout(() => this.loop(), 10000)
    }
  }

  async syncWork() {
    const data = await MainServerAxiosService.get<ApiBase<FileItem[]>>(
      `/coordinator/v1/find-file-work`
    )
    if (data.status !== 200 || !('data' in data.data)) {
      throw new Error('get file list failed')
    }
    const files = data.data.data

    console.log(`got work items`, files)
   // split the WorkItem into 6 so we could multithread
    const BATCH_SIZE = 1
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (file) => {
          try {
            await this.workItem(file)
          } catch (error) {
            console.error(`Error processing file ${file.fileKey}:`, error)
            // get stack trace
            console.error(error instanceof Error ? error.stack : 'No stack trace available');
            
            // Optionally, report the error back to the coordinator
   /*          await MainServerAxiosService.post(`/coordinator/v1/file-work-failed`, {
              fileId: file.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            }).catch((err) => console.error('Failed to report error to coordinator:', err)) */
          }
        })
      )
    }
  }
  public getStatus() {
    return { running: true, total: this.#transcodeTotal }
  }

  async workItem(file: FileItem) {
    // 0. init axios for this instance
    // routes: /s2s/metadata-patch for upload meta with thumb,
    // preview-create for preview
    const axios = new AxiosWithAuth(`https://${file.serverShard?.domain}`)
    // 1. download the file.
    const filePtr = await DownloaderService.downloadFileToPtr(
      `https://${file.serverShard?.domain}/${file.fileKey}`,
      file
    )

    // 2. extract-metadata 
    const metaPtr = await CompressorService.mkThumbnail(filePtr)
    console.log('Transcoders: thumbnail finished', metaPtr)

    // 3. upload meta-file
    const fileItem: FileItem = {
      ...file,
      isPrivate: !!file.isPrivate,
    }

    // post the file to the node
    const form = new FormData()
    form.append('fileItem', JSON.stringify(fileItem))
    form.append(
      'file',
      new Blob([await readFile(metaPtr.fileLocation)], { type: 'image/jpeg' }),
      `${file.fileKey}_thumbnail.jpg`
    )

    const uploadResp = await axios.post(`/s2s/metadata-patch`, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })

    if (uploadResp.status !== 200) {
      throw new Error(`failed to upload metadata for ${file.fileKey}, status: ${uploadResp.status}`)
    }

    // 4. destroy output
    await unlink(metaPtr.fileLocation).catch(console.warn)
    console.log('Metadata and meta extracted: ', file.fileKey)

    // 5. scaling down
    // after determining what's the height component
    // (obviously the smallest one)
    const whatActualHeight = Math.min(file.itemHeight ?? 3, file.itemWidth ?? 4)

    // if it is larger than 480p, make 480p vid/thumbnail. if it is larger than 720p,
    // make 480+720. if it's larger than 1080p, make 480/720/1080.
    /**
    the backend expects this:  
    const file = request.file('file')
    const {fileItem,quality} = request.body()
    and /s2s/preview-create
     */

    if (whatActualHeight >= 480) {
      console.log(`Preview: Since resolution is larger than 480p, making 480p preview.`)
      const scaledPtr = await CompressorService.mkScaledVidPhoto('480', filePtr)
      const form480 = new FormData()
      form480.append('fileItem', JSON.stringify(fileItem))
      form480.append('quality', '480')
      form480.append(
        'file',
        new Blob([await readFile(scaledPtr.fileLocation)], { type: 'image/jpeg' }),
        `${file.fileKey}_480p.${file.fileType === 'VIDEO' ? 'mp4' : 'jpeg'}`
      )
      const uploadResp480 = await axios.post(`/s2s/preview-create`, form480, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      if (uploadResp480.status !== 200) {
        throw new Error(
          `failed to upload 480p preview for ${file.fileKey}, status: ${uploadResp480.status}`
        )
      }
      this.#transcodeTotal++
      await unlink(scaledPtr.fileLocation).catch(console.warn)
    }

    if (whatActualHeight >= 720) {
      console.log(`Preview: Since resolution is larger than 720p, making 720p preview.`)
      const scaledPtr = await CompressorService.mkScaledVidPhoto('720', filePtr)
      const form720 = new FormData()
      form720.append('fileItem', JSON.stringify(fileItem))
      form720.append('quality', '720')
      form720.append(
        'file',
        new Blob([await readFile(scaledPtr.fileLocation)], { type: 'image/jpeg' }),
        `${file.fileKey}_720p.${file.fileType === 'VIDEO' ? 'mp4' : 'jpeg'}`
      )
      const uploadResp720 = await axios.post(`/s2s/preview-create`, form720, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      if (uploadResp720.status !== 200) {
        throw new Error(
          `failed to upload 720p preview for ${file.fileKey}, status: ${uploadResp720.status}`
        )
      }
      this.#transcodeTotal++
      await unlink(scaledPtr.fileLocation).catch(console.warn)
    }

    if (whatActualHeight >= 1080) {
      console.log(`Preview: Since resolution is larger than 1080p, making 1080p preview.`)
      const scaledPtr = await CompressorService.mkScaledVidPhoto('1080', filePtr)
      const form1080 = new FormData()
      form1080.append('fileItem', JSON.stringify(fileItem))
      form1080.append('quality', '1080')
      form1080.append(
        'file',
        new Blob([await readFile(scaledPtr.fileLocation)], { type: 'image/jpeg' }),
        `${file.fileKey}_1080p.${file.fileType === 'VIDEO' ? 'mp4' : 'jpeg'}`
      )
      const uploadResp1080 = await axios.post(`/s2s/preview-create`, form1080, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      if (uploadResp1080.status !== 200) {
        throw new Error(
          `failed to upload 1080p preview for ${file.fileKey}, status: ${uploadResp1080.status}`
        )
      }
      this.#transcodeTotal++
      await unlink(scaledPtr.fileLocation).catch(console.warn)
    }

    // 6. delete original file
    await unlink(filePtr.fileLocation).catch(console.warn)
    this.#transcodeTotal++
    console.log(`Finished processing file: ${file.fileKey}`)
    await this.markFileAsDone(file, 'finished')
  }
  /** simple helper to post this to main server:
   * 
   * 
  async markFile({ request, response }: HttpContext) {
    const { fileId, status } = request.body() // The status  'pending' | 'finished' | 'invalid-file' | null
    if (!fileId || !status) throw new NamedError('invalid argument', 'einval')
    const file = await ServerCommunicationService.markFile(fileId, status)
    return response.ok(createSuccess(file, 'File marked', 'success'))
  }

   */

  async markFileAsDone(file: FileItem, status: 'pending' | 'finished' | 'invalid-file' | null) {
    await MainServerAxiosService.post(`/coordinator/v1/mark-file`, {
      fileId: file.id,
      status,
    }).catch((err) => console.error('Failed to report work done to coordinator:', err))
  }
  
}

export default new TranscodeService()
