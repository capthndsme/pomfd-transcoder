import type { Socket } from 'socket.io-client'
import type { ValidApiMessages } from '../ApiMessages.js'

// ============================================
// Socket Type Definitions for Cap-Cloud Transcoder
// ============================================

// FileItem is defined inline here to avoid circular imports with models
// This matches the structure from the coordinator's FileItem model
interface FileItemSocket {
    id: string
    fileKey: string | null
    fileType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'OTHER' | null
    mimeType: string | null
    name: string
    isPrivate: boolean | null
    itemWidth: number | null
    itemHeight: number | null
    serverShard?: {
        domain: string
    } | null
}

/**
 * Data attached to each socket connection (set during authentication)
 */
type BaseSocketData = {
    serverId: number
    serverName?: string
    authenticated: boolean
    lastUpdate: number
    isBusy: boolean
    clientType: 'transcoder' | 'storage' | 'unknown'
}

/**
 * Generic payload wrapper for socket messages
 */
type BaseSocketPayload<T> = {
    data: T
    status: ValidApiMessages
    type: BaseMessageTypes
}

// ============================================
// Callback type helpers
// ============================================

type Callable<T> = (value: T) => void
type CallableCallback<T, C> = (value: T, callback: (value: C) => void) => void

// ============================================
// Event Definitions: Coordinator → Transcoder
// ============================================

type NewFileAckResponse = {
    accepted: boolean
    reason?: string
}

type WorkCancelledPayload = {
    fileId: string
}

type BaseServerToClient = {
    /** Push a new file to a transcoder for processing */
    'new-file': CallableCallback<FileItemSocket, NewFileAckResponse>

    /** Notify transcoder that work was cancelled (e.g., file deleted) */
    'work-cancelled': Callable<WorkCancelledPayload>

    /** Ping to check if transcoder is alive */
    'ping': CallableCallback<{ timestamp: number }, { pong: true; timestamp: number }>
}

// ============================================
// Event Definitions: Transcoder → Coordinator
// ============================================

type MarkFilePayload = {
    fileId: string
    status: 'pending' | 'finished' | 'invalid-file' | null
}

type MarkFileResponse = {
    success: boolean
    error?: string
}

type StatusUpdatePayload = {
    isBusy: boolean
    queueSize: number
    currentFileId?: string
}

type ClaimWorkPayload = {
    fileId: string
}

type ClaimWorkResponse = {
    success: boolean
    file?: FileItemSocket
    error?: string
}

type BaseClientToServer = {
    /** Transcoder reports file processing status */
    'mark-file': CallableCallback<MarkFilePayload, MarkFileResponse>

    /** Transcoder reports its current status/load */
    'status-update': Callable<StatusUpdatePayload>

    /** Transcoder explicitly claims a file for processing */
    'claim-work': CallableCallback<ClaimWorkPayload, ClaimWorkResponse>

    /** Request work from coordinator (fallback/initial load) */
    'request-work': CallableCallback<void, { files: FileItemSocket[] }>
}

// ============================================
// Socket Type Aliases (Client-side perspective)
// ============================================

/** Client socket type (Transcoder connecting to Coordinator) */
type TranscoderSocket = Socket<BaseServerToClient, BaseClientToServer>

type BaseMessageTypes = keyof BaseClientToServer | keyof BaseServerToClient

// ============================================
// Exports
// ============================================

export type {
    FileItemSocket,
    TranscoderSocket,
    BaseSocketData,
    BaseSocketPayload,
    Callable,
    CallableCallback,
    BaseClientToServer,
    BaseServerToClient,
    BaseMessageTypes,
    // Payload types for external use
    NewFileAckResponse,
    WorkCancelledPayload,
    MarkFilePayload,
    MarkFileResponse,
    StatusUpdatePayload,
    ClaimWorkPayload,
    ClaimWorkResponse,
}
