import { Writable, WritableOptions } from 'stream';
import { SmtpCommand } from '../shared/SmtpCommand';
import { DATA_END, LINE_SEPARATOR } from '../shared/SmtpConstants';
import { SmtpDataBuffer } from '../shared/SmtpSegmentedReader';

export enum SmtpStreamMode {
    Command = 'COMMAND',
    Data = 'DATA',
    BinaryData = 'BDAT',
    Line = 'LINE',
}

export class SmtpStream extends Writable {
    protected _buffer: SmtpDataBuffer = new SmtpDataBuffer();
    protected _mode: SmtpStreamMode = SmtpStreamMode.Command;
    protected _data_max_length: number | null = null;
    protected _binary_expected_length: number | null = null;
    protected _line_identifier: number | string | null = null;

    /**
     * Constructs a new SMTP stream.
     * @param options the options.
     */
    public constructor(options: WritableOptions,
        public readonly on_binary_data: (data: string) => Promise<void>,
        public readonly on_command: (data: string) => Promise<void>,
        public readonly on_data: (data: string) => Promise<void>,
        public readonly on_data_max_reached: () => Promise<void>,
        public readonly on_line: (data: string, identifier: string | number | null) => Promise<void>) {
        super(options);
    }

    /**
     * Enters the command stream mode (waits for '\r\n').
     */
    public enter_command_mode(): void {
        this._mode = SmtpStreamMode.Command;
    }

    /**
     * Enters the data stream mode (waits for '\r\n.\r\n').
     * @param max_length the max length pf the data.
     */
    public enter_data_mode(max_length: number | null = null): void {
        this._mode = SmtpStreamMode.Data;
        this._data_max_length = max_length;
    }

    /**
     * Enters the binary data mode.
     * @param expected_size the expected size to read.
     */
    public enter_bdat_mode(expected_size: number): void {
        this._mode = SmtpStreamMode.BinaryData;
        this._binary_expected_length = expected_size;
    }

    /**
     * Enters line mode, this is used for stupid AUTH crap.
     * @param identifier the identifier.
     */
    public enter_line_mode(identifier: string | number | null = null) {
        this._mode = SmtpStreamMode.Line;
        this._line_identifier = identifier;
    }

    /**
     * Handles a new chunk of data.
     * @param chunk the chunk of data.
     * @param encoding the encoding.
     * @param callback the callback.
     * @returns nothing.
     */
    public async _write(chunk: Buffer, encoding: BufferEncoding, next: (error?: Error | null) => void): Promise<void> {
        // Checks if there is anything to read at all.
        if (!chunk || chunk.length === 0) {
            next();
            return;
        }

        // Writes the chunk to the buffer.
        this._buffer.write(chunk);

        // Checks the mode of the stream, and determines what to do.
        switch (this._mode) {
            case SmtpStreamMode.BinaryData:
                await this._handle_binary_data_write();
                break;
            case SmtpStreamMode.Data:
                await this._handle_data_write();
                break;
            case SmtpStreamMode.Command:
                await this._handle_command_write();
                break;
            case SmtpStreamMode.Line:
                await this._handle_line_write();
                break;
            default:
                next(new Error('Stream in invalid state.'));
                break;
        }

        // Goes to the next chunk.
        next();
    }

    /**
     * Handles a line write.
     */
    protected async _handle_line_write(): Promise<void> {
        // Reads the segment, and if not there just return.
        let segment: string | null;
        if ((segment = this._buffer.segment(LINE_SEPARATOR)) === null) {
            return;
        }

        // We've read the data segment.
        await this.on_line(segment, this._line_identifier);
    }

    /**
     * Handles a binary data write.
     */
    protected async _handle_binary_data_write(): Promise<void> {
        // Checks if the expected length is set.
        if (!this._binary_expected_length) {
            throw new Error('Binary expected length must be set.');
        }

        // If there is not enough data yet, return.
        if (this._buffer.length < this._binary_expected_length) {
            return;
        }

        // There is enough data, read it from the buffer and perform the binary data callback.
        const data: string = this._buffer.read(this._binary_expected_length);
        await this.on_binary_data(data);
    }

    /**
     * Handles a data write.
     */
    protected async _handle_data_write(): Promise<void> {
        // Checks if the data is too large.
        if (this._data_max_length && this._buffer.length > this._data_max_length) {
            this.on_data_max_reached();
            return;
        }

        // Reads the segment, and if not there just return.
        let segment: string | null;
        if ((segment = this._buffer.segment(DATA_END, -2 /* -2, preserved '\r\n' */)) === null) {
            return;
        }

        // We've read the data segment.
        await this.on_data(segment)
    }

    /**
     * Handles a command write.
     */
    protected async _handle_command_write(): Promise<void> {
        // Reads the segment, and if not there just return.
        let segment: string | null;
        if ((segment = this._buffer.segment(LINE_SEPARATOR)) === null) {
            return;
        }

        // Calls the command callback.
        await this.on_command(segment);
    }
}