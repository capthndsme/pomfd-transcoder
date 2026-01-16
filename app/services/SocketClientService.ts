import { io, Socket } from 'socket.io-client'
import env from '#start/env'
import FileItem from '#models/file_item'
import type {
    BaseServerToClient,
    BaseClientToServer,
    NewFileAckResponse,
    MarkFilePayload,
    StatusUpdatePayload,
    FileItemSocket,
    WorkCancelledPayload,
} from '../../shared/types/wss/WssBase.js'

type SocketClient = Socket<BaseServerToClient, BaseClientToServer>

/**
 * SocketClientService - Connects transcoder to the Coordinator via Socket.IO
 * 
 * This replaces the HTTP polling mechanism with real-time push notifications.
 * Coordinator pushes new files; Transcoder reports status back.
 */
class SocketClientService {
    #socket: SocketClient | null = null
    #booted = false
    #reconnectAttempts = 0
    #maxReconnectAttempts = 10

    /** Callback for when new work arrives */
    #onNewFileCallback: ((file: FileItem) => Promise<NewFileAckResponse>) | null = null

    /** Current status */
    #isBusy = false
    #queueSize = 0
    #currentFileId: string | undefined = undefined

    /**
     * Boot the socket client - connect to Coordinator
     */
    boot() {
        if (this.#booted) return
        this.#booted = true

        const coordinatorUrl = env.get('COORDINATOR_URL')
        const serverId = env.get('COORDINATOR_SERVER_ID')
        const apiKey = env.get('COORDINATOR_API_KEY')

        if (!coordinatorUrl || !serverId || !apiKey) {
            console.error('❌ SocketClientService: Missing COORDINATOR_URL, COORDINATOR_SERVER_ID, or COORDINATOR_API_KEY')
            return
        }

        console.log(`🔌 Connecting to Coordinator: ${coordinatorUrl}`)

        this.#socket = io(coordinatorUrl, {
            auth: {
                serverId: Number(serverId),
                apiKey,
                clientType: 'transcoder',
            },
            reconnection: true,
            reconnectionAttempts: this.#maxReconnectAttempts,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 30000,
            timeout: 20000,
        }) as SocketClient

        this.#setupEventHandlers()
    }

    /**
     * Setup all socket event handlers
     */
    #setupEventHandlers() {
        if (!this.#socket) return

        // ========================================
        // Connection lifecycle events
        // ========================================

        this.#socket.on('connect', () => {
            console.log('✅ Connected to Coordinator')
            this.#reconnectAttempts = 0

            // Report our current status
            this.#sendStatusUpdate()
        })

        this.#socket.on('disconnect', (reason: string) => {
            console.log(`🔌 Disconnected from Coordinator: ${reason}`)
        })

        this.#socket.on('connect_error', (error: Error) => {
            this.#reconnectAttempts++
            console.error(`❌ Connection error (attempt ${this.#reconnectAttempts}):`, error.message)
        })

        // ========================================
        // Coordinator → Transcoder events
        // ========================================

        /**
         * new-file: Coordinator pushes a file for processing
         */
        this.#socket.on('new-file', async (file: FileItemSocket, ack: (resp: NewFileAckResponse) => void) => {
            console.log(`📥 Received new file: ${file.fileKey}`)

            // If we're busy or have no callback, reject
            if (this.#isBusy) {
                console.log(`⚠️ Rejecting ${file.fileKey}: busy`)
                ack({ accepted: false, reason: 'Transcoder is busy' })
                return
            }

            if (!this.#onNewFileCallback) {
                console.log(`⚠️ Rejecting ${file.fileKey}: no handler registered`)
                ack({ accepted: false, reason: 'No work handler registered' })
                return
            }

            // Accept the work
            this.#isBusy = true
            this.#currentFileId = file.id
            ack({ accepted: true })

            // Process the file - convert socket type to FileItem
            try {
                // Cast the socket file to our local FileItem type
                const fileItem = file as unknown as FileItem
                await this.#onNewFileCallback(fileItem)
                // Callback handles marking as finished
                console.log(`✅ Completed processing: ${file.fileKey}`)
            } catch (error) {
                console.error(`❌ Error processing ${file.fileKey}:`, error)
            } finally {
                this.#isBusy = false
                this.#currentFileId = undefined
                this.#sendStatusUpdate()
            }
        })

        /**
         * work-cancelled: Coordinator notifies us work was cancelled
         */
        this.#socket.on('work-cancelled', (payload: WorkCancelledPayload) => {
            console.log(`🚫 Work cancelled: ${payload.fileId}`)

            // If we're currently working on this file, we should stop
            if (this.#currentFileId === payload.fileId) {
                // Note: actual cancellation logic would need to be implemented in the work handler
                console.log(`⚠️ Currently processing this file - cancellation not yet supported`)
            }
        })

        /**
         * ping: Coordinator checking if we're alive
         */
        this.#socket.on('ping', (payload: { timestamp: number }, ack: (resp: { pong: true; timestamp: number }) => void) => {
            ack({ pong: true, timestamp: payload.timestamp })
        })
    }

    // ========================================
    // Public API: Register work handler
    // ========================================

    /**
     * Register a callback to handle incoming files
     * This is called by TranscodeService
     */
    onNewFile(callback: (file: FileItem) => Promise<NewFileAckResponse>) {
        this.#onNewFileCallback = callback
    }

    // ========================================
    // Public API: Send events to Coordinator
    // ========================================

    /**
     * Mark a file's processing status
     */
    async markFile(fileId: string, status: MarkFilePayload['status']): Promise<boolean> {
        if (!this.#socket?.connected) {
            console.warn('⚠️ Cannot mark file: not connected to Coordinator')
            return false
        }

        try {
            const response = await this.#socket.emitWithAck('mark-file', { fileId, status })
            return response.success
        } catch (error) {
            console.error('❌ Failed to mark file:', error)
            return false
        }
    }

    /**
     * Request work from Coordinator (fallback/initial load)
     */
    async requestWork(): Promise<FileItem[]> {
        if (!this.#socket?.connected) {
            console.warn('⚠️ Cannot request work: not connected to Coordinator')
            return []
        }

        try {
            const response = await this.#socket.emitWithAck('request-work', undefined)
            // Cast the socket types to our local FileItem type
            return response.files as unknown as FileItem[]
        } catch (error) {
            console.error('❌ Failed to request work:', error)
            return []
        }
    }

    /**
     * Update our status (busy/idle)
     */
    #sendStatusUpdate() {
        if (!this.#socket?.connected) return

        const payload: StatusUpdatePayload = {
            isBusy: this.#isBusy,
            queueSize: this.#queueSize,
            currentFileId: this.#currentFileId,
        }

        this.#socket.emit('status-update', payload)
    }

    /**
     * Manually set busy status (called by TranscodeService)
     */
    setBusy(busy: boolean, currentFileId?: string) {
        this.#isBusy = busy
        this.#currentFileId = currentFileId
        this.#sendStatusUpdate()
    }

    // ========================================
    // Status & lifecycle
    // ========================================

    /**
     * Check if connected to Coordinator
     */
    isConnected(): boolean {
        return this.#socket?.connected ?? false
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            connected: this.isConnected(),
            isBusy: this.#isBusy,
            currentFileId: this.#currentFileId,
            reconnectAttempts: this.#reconnectAttempts,
        }
    }

    /**
     * Disconnect from Coordinator
     */
    disconnect() {
        this.#socket?.disconnect()
        this.#socket = null
        this.#booted = false
    }
}

export default new SocketClientService()
