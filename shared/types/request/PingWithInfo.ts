export type PingWithInfo = {
  totalKiB: number
  freeKIB: number
  bwIn?: number,
  bwOut?: number,
  cpuUse?: number,
  ramFreeBytes?: number,
  ramTotalBytes?: number
}
