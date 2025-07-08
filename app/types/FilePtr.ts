import FileItem from '#models/file_item'

type FilePtr = {
  fileLocation: string
  fileInfo: FileItem,
  extraInternalInfo?: {
    width: number
    height: number
  }
  $opaque: '__file_ptr__'
}

function makeFilePtr(loc: string, fileInfo: FileItem) {
  return {
    fileLocation: loc,
    fileInfo,
    $opaque: '__file_ptr__',
  } as FilePtr
}

function getFilePtr(loc: FilePtr) {
  return loc.fileLocation
}

export { type FilePtr, makeFilePtr, getFilePtr }
