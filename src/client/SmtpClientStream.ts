import { Writable, WritableOptions } from "stream";
import { LINE_SEPARATOR } from "../shared/SmtpConstants";
import { SmtpResponse } from "../shared/SmtpResponse";
import { SmtpDataBuffer } from "../shared/SmtpSegmentedReader";

export enum SmtpClientStreamMode {
  Response = "RESPONSE",
}

export class SmtpClientStream extends Writable {
  protected _buffer: SmtpDataBuffer = new SmtpDataBuffer();
  protected _mode: SmtpClientStreamMode = SmtpClientStreamMode.Response;
  protected _response_decode_state: Generator<
    void,
    SmtpResponse,
    string
  > | null = null;

  /**
   * Constructs a new SMTP client stream.
   * @param options the options.
   */
  public constructor(options?: WritableOptions) {
    super(options);
  }

  /**
   * Enters the response stream mode (waits for '\r\n').
   */
  public enter_response_mode(): void {
    this._mode = SmtpClientStreamMode.Response;
  }

  /**
   * Handles a new chunk of data.
   * @param chunk the chunk of data.
   * @param encoding the encoding.
   * @param callback the callback.
   * @returns nothing.
   */
  public async _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    next: (error?: Error | null) => void
  ): Promise<void> {
    // Checks if there is anything to read at all.
    if (!chunk || chunk.length === 0) {
      next();
      return;
    }

    // Writes the chunk to the buffer.
    this._buffer.write(chunk);

    // Checks the mode of the stream, and determines what to do.
    switch (this._mode) {
      case SmtpClientStreamMode.Response:
        await this._handle_response_write();
        break;
      default:
        next(new Error("Stream in invalid state."));
        break;
    }

    // Goes to the next chunk.
    next();
  }

  /**
   * Handles a response write.
   */
  protected async _handle_response_write(): Promise<void> {
    // Reads the segments, and if not there just return.
    let segment: string | null;
    while (true) {
      // Gets the segment, if none. Break.
      if ((segment = this._buffer.segment(LINE_SEPARATOR)) === null) {
        break;
      }

      // Checks if we need to initialize the state for the decoder.
      if (!this._response_decode_state) {
        this._response_decode_state = SmtpResponse.fancy_decode();
        this._response_decode_state.next();
      }

      // Feeds the segment to the decoder, and checks if we're done.
      const result: IteratorResult<void, SmtpResponse> =
        this._response_decode_state.next(segment);
      if (!result.done) {
        continue;
      }

      // Emits the response event.
      this.emit("response", result.value);

      // Clears the state.
      this._response_decode_state = null;

      // If the mode is now different break.
      if (this._mode !== SmtpClientStreamMode.Response) {
        break;
      }
    }
  }
}
