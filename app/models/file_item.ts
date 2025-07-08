import { DateTime } from 'luxon'
import { type FileType } from '../../shared/types/FileType.js'

import User from './user.js'
import ServerShard from './server_shard.js'

/** NOTE: This is a DTO basically, as this si  */
export default class FileItem {
  declare id: string
  /** Uuid generation */

  declare createdAt: DateTime

  declare updatedAt: DateTime

  declare ownerId: string

  declare parentFolder: string | null

  declare name: string

  declare description: string | null

  declare isPrivate: boolean | null

  declare isFolder: boolean

  declare originalFileName: string | null

  declare mimeType: string | null

  declare fileType: FileType | null

  declare fileKey: string | null

  declare previewKey: string | null

  declare previewBlurHash: string | null

  declare serverShardId: number | null

  declare fileSize: number | null

  // Original file: replicationParent = null
  // Replica: points to original's UUID

  declare replicationParent: string | null

  declare user: User | null

  declare serverShard: ServerShard | null

  declare parent: FileItem | null

  declare children: FileItem[]

  declare replicas: FileItem[]

  /// item width
  declare itemWidth: number | null

  /// item height
  declare itemHeight: number | null
}
