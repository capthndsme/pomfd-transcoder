declare module 'ffmpeg-extract-frames' {
  interface ExtractFramesOptions {
    log?: (data: { cmd: string }) => void;
    input: string;
    output: string;
    timestamps?: number[];
    offsets?: number[];
    fps?: number;
    numFrames?: number;
    ffmpegPath?: string;
  }

  function extractFrames(opts: ExtractFramesOptions): Promise<string>;

  export = extractFrames;
}