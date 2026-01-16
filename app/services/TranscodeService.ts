import FileItem from '#models/file_item'
import { ApiBase } from '../../shared/types/ApiBase.js'

import MainServerAxiosService from './MainServerAxiosService.js'
import DownloaderService from './DownloaderService.js'
import CompressorService from './CompressorService.js'
import SocketClientService from './SocketClientService.js'
import { readFile, unlink } from 'fs/promises'
import AxiosWithAuth from './AxiosWithAuth.js'

/**
 * TranscodeService - Processes media files for thumbnails and previews
 * 
 * Now supports two modes:
 * 1. Socket.IO (preferred): Real-time push from Coordinator
 * 2. HTTP polling (fallback): Polls for work if socket is disconnected
 */
class TranscodeService {
  #transcodeTotal: number = 0
  #booted = false
  #useSocket = true // Enable socket mode by default

  constructor() {
    console.log('TranscodeService has been initialized.')
    this.start()
  }

  public start() {
    console.log('TranscodeService has started.')
    if (this.#booted) return
    this.#booted = true

    if (this.#useSocket) {
      this.#startSocketMode()
    } else {
      // Fallback to polling
      setTimeout(() => this.loop(), 1000)
    }
  }

  /**
   * Socket Mode: Connect to Coordinator and receive work via push
   */
  #startSocketMode() {
    console.log('🔌 Starting in Socket.IO mode...')

    // Boot the socket client
    SocketClientService.boot()

    // Register our work handler
    SocketClientService.onNewFile(async (file: FileItem) => {
      try {
        await this.workItem(file)
        return { accepted: true }
      } catch (error) {
        console.error(`❌ Work failed for ${file.fileKey}:`, error)
        return { accepted: false, reason: String(error) }
      }
    })

    // Also start a slower fallback loop for any missed work
    // This handles files that were uploaded before socket connected
    setTimeout(() => this.#fallbackLoop(), 5000)
  }

  /**
   * Fallback loop: Occasionally check for orphaned work
   * Runs less frequently than the old polling loop
   */
  async #fallbackLoop() {
    try {
      // Only poll if socket is connected but we're not busy
      if (SocketClientService.isConnected()) {
        const status = SocketClientService.getStatus()
        if (!status.isBusy) {
          const files = await SocketClientService.requestWork()
          if (files.length > 0) {
            console.log(`📋 Fallback: Found ${files.length} orphaned files`)
            // Process one at a time
            for (const file of files) {
              if (SocketClientService.getStatus().isBusy) break
              try {
                SocketClientService.setBusy(true, file.id)
                await this.workItem(file)
              } catch (error) {
                console.error(`❌ Fallback work failed:`, error)
              } finally {
                SocketClientService.setBusy(false)
              }
            }
          }
        }
      } else {
        // Socket not connected - use HTTP fallback
        await this.syncWorkHttp()
      }
    } catch (e) {
      console.warn(`Fallback loop failed`, e)
    } finally {
      // Run fallback less frequently - every 60 seconds
      setTimeout(() => this.#fallbackLoop(), 60000)
    }
  }

  /**
   * Old polling loop (kept for fallback)
   */
  async loop() {
    try {
      await this.syncWorkHttp()
    } catch (e) {
      console.warn(`Transcode Loop failed`, e)
    } finally {
      setTimeout(() => this.loop(), 10000)
    }
  }

  /**
   * HTTP-based work sync (fallback when socket is down)
   */
  async syncWorkHttp() {
    const data = await MainServerAxiosService.get<ApiBase<FileItem[]>>(
      `/coordinator/v1/find-file-work`
    )
    if (data.status !== 200 || !('data' in data.data)) {
      throw new Error('get file list failed')
    }
    const files = data.data.data

    if (files.length === 0) return

    console.log(`[HTTP Fallback] got work items`, files.length)

    // Process one at a time for fallback
    for (const file of files) {
      try {
        await this.workItem(file)
      } catch (error) {
        console.error(`Error processing file ${file.fileKey}:`, error)
        console.error(error instanceof Error ? error.stack : 'No stack trace available')
        await this.markFile(file, null).catch(console.error)
      }
    }
  }

  public getStatus() {
    const socketStatus = SocketClientService.getStatus()
    return {
      running: true,
      total: this.#transcodeTotal,
      socketConnected: socketStatus.connected,
      socketBusy: socketStatus.isBusy,
      currentFile: socketStatus.currentFileId,
    }
  }

  async workItem(file: FileItem) {
    // 0. init axios for this instance
    const axios = new AxiosWithAuth(`https://${file.serverShard?.domain}`)

    // 1. download the file.
    const fileKey = file.fileKey ?? ''
    const domain = file.serverShard?.domain ?? ''
    const downloadUrl =
      fileKey.startsWith('http://') || fileKey.startsWith('https://') || fileKey.startsWith('//')
        ? fileKey
        : `https://${domain}/${fileKey}`

    const filePtr = await DownloaderService.downloadFileToPtr(downloadUrl, file)

    // 1.5 immediately lock 
    await this.markFile(file, 'pending')

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
    const whatActualHeight = Math.min(file.itemHeight ?? 3, file.itemWidth ?? 4)

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
    await this.markFile(file, 'finished')
  }

  /**
   * Mark file status - uses Socket.IO if connected, falls back to HTTP
   */
  async markFile(file: FileItem, status: 'pending' | 'finished' | 'invalid-file' | null) {
    // Try socket first
    if (SocketClientService.isConnected()) {
      const success = await SocketClientService.markFile(file.id, status)
      if (success) return
      console.warn('Socket markFile failed, falling back to HTTP')
    }

    // Fallback to HTTP
    await MainServerAxiosService.post(`/coordinator/v1/mark-file`, {
      fileId: file.id,
      status,
    }).catch((err) => console.error('Failed to report work done to coordinator:', err))
  }
}

export default new TranscodeService()
