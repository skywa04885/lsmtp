import {Flags} from "../helpers/Flags";
import {Queue} from "../helpers/Queue";
import {SmtpCommand, SmtpCommandType} from "../shared/SmtpCommand";
import {LINE_SEPARATOR} from "../shared/SmtpConstants";
import {SmtpResponse} from "../shared/SmtpResponse";
import {SmtpSocket} from "../shared/SmtpSocket";
import {SmtpClientDNS} from "./SmtpClientDNS";
import {SmtpClientStream} from "./SmtpClientStream";
import {SmtpClientErrorOrigin, SmtpClientFatalTransactionError, SmtpClientTransactionError} from "./SmtpClientError";
import {Logger} from "../helpers/Logger";
import {SmtpCapability} from "../shared/SmtpCapability";
import {EventEmitter} from "stream";
import {SmtpClientAssignment} from "./SmtpClientAssignment";
import {smtp_client_server_opts_from_capabilities, SmtpClientServerOpts} from "./SmtpClientServerConfig";

export enum SmtpClientState {
    Prep = 'PREP',
    Busy = 'BUSY',
    Idle = 'IDLE',
}

export enum SmtpClientFlag {
    ESMTP = (1 << 0),                   // The server is an ESMTP server.
    SMTP = (1 << 1),                    // The server is an SMTP server.
}

export interface SmtpClientConfig {
    // Server
    resolve_mx: boolean;                // If we should resolve MX or just connect directly.
    server_domain: string;              // The server domain included in the EHLO/ HELO.
    hostname: string;                   // The server hostname.
    port: number;                       // Server port.
    // Keep-Alive
    keep_alive_for: number;             // The number of milliseconds to keep the connection alive after last BUSY.
    keep_alive_noop_interval: number;   // The number of milliseconds between each NOOP while keeping the con open.
    // Logging / Debugging.
    debug: boolean;                     // If the client should be in debug mode.
}

export class SmtpClient extends EventEmitter {
    protected _state: SmtpClientState = SmtpClientState.Prep;
    protected _smtp_socket: SmtpSocket | null = null;
    protected _stream: SmtpClientStream | null = null;
    protected _generator: any = null;
    protected _assignments: Queue<SmtpClientAssignment> = new Queue<SmtpClientAssignment>();
    protected _flags: Flags = new Flags();
    protected _logger: Logger;
    protected _idle_noop_interval: null | NodeJS.Timeout = null;
    protected _server_opts: SmtpClientServerOpts | null = null;

    protected _total_assigned: number = 0;          // The number of total assigned messages.
    protected _total_sent: number = 0;              // The number of total sent messages.

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Constructor and Getters / Setters                                                                              //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * Constructs a new SmtpClient.
     * @param config the client configuration.
     */
    public constructor(public readonly config: SmtpClientConfig) {
        super();
        this._logger = new Logger(`SMTPClient<${this.config.hostname}>`)
    }

    /**
     * Gets the total number of sent messages.
     */
    public get total_sent(): number {
        return this._total_sent;
    }

    /**
     * Gets the total number of assigned messages.
     */
    public get total_assigned(): number {
        return this._total_assigned;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Public instance methods                                                                                        //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * Assigns a new assignment to the current client.
     * @param assignment the assignment.
     */
    public assign(assignment: SmtpClientAssignment) {
        // Increments the assigned counter, and performs the debug log.
        ++this._total_assigned;
        if (this.config.debug) {
            this._logger.trace(`Enqueueing new assignment, to: `, assignment.to);
        }

        // Enqueues a new assignment.
        this._assignments.enqueue(assignment);

        // Checks if the state is idle, and the size is larger than one.
        if (this._assignments.size >= 1 && this._state === SmtpClientState.Idle) {
            this.next();
        }
    }

    /**
     * Initializes the SMTP client.
     */
    public async init(): Promise<void> {
        if (this.config.debug) {
            this._logger.trace('Initializing SmtpClient ...');
        }

        let exchange: string;
        if (this.config.resolve_mx) {
            // Resolves the MX records.
            const mx: string[] = await SmtpClientDNS.mx(this.config.hostname);
            if (mx.length === 0) {
                throw new Error('Could not initialize SMTP client, no MX records found.');
            }

            // Selects an exchange.
            exchange = mx[0];
            if (this.config.debug) {
                this._logger.trace(`MX Resolved found ${mx.length} exchanges, using exchange: '${exchange}'`);
            }
        } else {
            exchange = this.config.hostname;
        }

        // Sets the state to preparing.
        this._state = SmtpClientState.Prep;

        // Enters the initial generator mode.
        this._generator = this.initial_main();
        this._generator.next(); // Goes to the first YIELD.

        // Creates the client stream.
        this._stream = new SmtpClientStream({}, (response: SmtpResponse) => this.on_response(response));
        this._stream.on('error', (err: Error) => console.error);

        // Creates the smtp socket.
        this._smtp_socket = SmtpSocket.connect(false, exchange, 25);
        this._smtp_socket.socket.pipe(this._stream);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Protected instance methods                                                                                     //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    protected async use_esmtp_generator() {
        this._generator = this.esmtp_generator();
        await this._generator.next();
    }

    protected async use_smtp_generator() {
        this._generator = this.smtp_generator();
        await this._generator.next();
    }

    protected use_idle_generator() {
        this._generator = this.idle_generator();
        this._generator.next();
    }

    /**
     * Gets called when there is a response.
     * @param response the response.
     */
    protected async on_response(response: SmtpResponse): Promise<void> {
        if (this.config.debug) {
            this._logger.trace('>> [RESPONSE]', response.encode(false));
        }
        await this._generator?.next(response);
    }

    /**
     * Writes an command to the SMTP socket.
     * @param command the command.
     */
    protected write_command(command: SmtpCommand): void {
        if (this.config.debug) {
            this._logger.trace('<< [COMMAND]', command.encode(false));
        }
        this._smtp_socket?.write(command.encode(true));
    }

    /**
     * Writes the data in the SmtpClient instance, in the string method.
     */
    protected write_data() {
        const assignment: SmtpClientAssignment = this._assignments.peek();
        
        if (typeof assignment.data !== 'string') {
            throw new Error('Data must be of type string!');
        }

        let line_start: number = 0;
        let line_end: number = assignment.data.indexOf(LINE_SEPARATOR, line_start + LINE_SEPARATOR.length);

        while (line_end !== -1) {
            let line: string = assignment.data.substring(line_start, line_end);
            if (line === '.') {
                line += '.';
            }

            this._smtp_socket?.write(`${line}${LINE_SEPARATOR}`);
            
            line_start = line_end + LINE_SEPARATOR.length;
            line_end = assignment.data.indexOf(LINE_SEPARATOR, line_start);
        }

        this._smtp_socket?.write(`.${LINE_SEPARATOR}`);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Protected Generators                                                                                           //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * The initial main generator, which just reads the initial greeting and does something with it.
     */
    protected async *initial_main(): AsyncGenerator<void, void, SmtpResponse> {
        // Gets the initial greeting / response.
        let response: SmtpResponse = yield;
        if (this.config.debug) {
            this._logger.trace(`Received server greeting: ${response.status} '${response.message_string}'.`);
        }

        // Checks if the response status is correct, if not throw a fatal error
        //  since the client now cannot be initialized at all.
        if (response.status !== 220) {
            throw new SmtpClientFatalTransactionError(SmtpClientErrorOrigin.GeneratorInitial,
                'Initial greeting (response) status code is not 200, aborting ...', response);
        }

        // Checks if the response message contains 'SMTP' or 'ESMTP', if none of these we will assume
        //  it is 'SMTP', and thus use older commands.
        const response_message_segments: string[] = response.message_segments.map((segment: string) => segment.trim().toUpperCase());
        if (response_message_segments.includes("ESMTP")) {
            this._flags.set(SmtpClientFlag.ESMTP);

            if (this.config.debug) {
                this._logger.trace(`Server supports ESMTP.`);
            }

            // Performs the initial EHLO, since we will later use RSET, and waits for the response.
            this.write_command(new SmtpCommand(SmtpCommandType.Ehlo, [ this.config.server_domain ]));
            response = yield;

            // Reads the capabilities from the response message.
            const capabilities: SmtpCapability[] = SmtpCapability.decode_many(
                response.message as string[], 1 /* Skip the initial line, there is nothing there. */);

            // Gets the server options from the capabilities.
            try {
                this._server_opts = smtp_client_server_opts_from_capabilities(capabilities);
            } catch (e) {
                throw new SmtpClientFatalTransactionError(SmtpClientErrorOrigin.GeneratorInitial,
                    `Invalid capabilities: ${e}`, response);
            }
        } else if (response_message_segments.includes("SMTP")) {
            this._flags.set(SmtpClientFlag.SMTP);
            if (this.config.debug) {
                this._logger.trace(`Server supports SMTP.`);
            }
        } else {
            this._flags.set(SmtpClientFlag.SMTP);
            if (this.config.debug) {
                this._logger.trace(`Server did not advertise either SMTP or ESMTP, assuming SMTP (to be safe).`);
            }
        }

        // Calls the next method, to either enter IDLE mod or transmit a message.
        await this.next();
    }

    /**
     * Gets called when we are done with something, and we want to transmit a new message,
     *  or if none queued, enter IDLE mode.
     */
    protected async next() {
        // Checks if there are any assignments, if not enter IDLE mode.
        if (this._assignments.size === 0) {
            // Enters IDLE mode.
            if (this.config.debug) {
                this._logger.trace('Entering IDLE mode, no assignments queued ...');
            }

            // Uses the IDLE generator.
            this.use_idle_generator();

            // Sets the state.
            this._state = SmtpClientState.Idle;

            // Sets the interval.
            this._idle_noop_interval = setTimeout(() => {
                this._generator.next();
            }, this.config.keep_alive_noop_interval);
            return;
        }

        // If there is an idle generator running, close it.
        if (this._state === SmtpClientState.Idle) {
            clearTimeout(this._idle_noop_interval as NodeJS.Timeout);
            this._idle_noop_interval = null;
            (this._generator as AsyncGenerator<void, void, boolean | SmtpResponse>).next(true);
        }

        // There are assignments, start processing.. So enter busy mode, and call one of the
        //  generators depending on the server supporting SMTP or ESMTP.
        if (this.config.debug) {
            this._logger.trace('Entering busy mode ...');
        }

        // Sets the state to busy.
        this._state = SmtpClientState.Busy;

        // Selects the generator depending on the server type.
        if (this._flags.get(SmtpClientFlag.SMTP)) {
            if (this.config.debug) {
                this._logger.trace('Using SMTP Generator.');
            }
            await this.use_smtp_generator();
        } else if (this._flags.get(SmtpClientFlag.ESMTP)) {
            if (this.config.debug) {
                this._logger.trace('Using ESMTP Generator.');
            }
            await this.use_esmtp_generator();
        } else {
            throw new SmtpClientFatalTransactionError(SmtpClientErrorOrigin.Next,
                'No SMTP or ESMTP flag set.');
        }
    }

    protected *idle_generator() {
        // Stays in loop forever.
        while (true) {
            // Sends the NOOP.
            this.write_command(new SmtpCommand(SmtpCommandType.Noop, null));

            // Waits for the NOOP response.
            const response: SmtpResponse = (yield) as SmtpResponse;
            if (response.status !== 250) {
                throw new SmtpClientFatalTransactionError(SmtpClientErrorOrigin.GeneratorIDLE,
                    'NOOP command did not receive valid status of 250',  response);
            }

            // Since we're being called by a timer, reset it. Then we yield, and wait for a new
            //  next call to execute the loop again.
            this._idle_noop_interval?.refresh();
            yield;
        }
    }

    /**
     * the SMTP generator, this generator gets called when we want to transmit an SMTP message.
     */
    protected async *smtp_generator() {

        // Increments the number of sent emails.
        ++this._total_sent;
    }

    /**
     * the ESMTP generator, this generator gets called when we want to transmit an ESMTP message.
     */
    protected async *esmtp_generator() {
        let response: SmtpResponse;

        // Gets the current assignment.
        const assignment: SmtpClientAssignment = this._assignments.peek();

        // Writes the RSET command.
        this.write_command(new SmtpCommand(SmtpCommandType.Rset, null));
        response = yield;
        if (response.status !== 250) {
            throw new SmtpClientTransactionError(SmtpClientErrorOrigin.GeneratorESMTP,
                'Invalid RSET response.', response)
        }

        // Writes the MAIL command.
        this.write_command(new SmtpCommand(SmtpCommandType.Mail, [ `FROM:<${assignment.from}>` ]));
        response = yield;

        // Writes the RCPT command.
        for (const mailbox of assignment.to) {
            this.write_command(new SmtpCommand(SmtpCommandType.Rcpt, [ `TO:<${mailbox}>` ]));
            response = yield;
        }

        // Writes the DATA command.
        this.write_command(new SmtpCommand(SmtpCommandType.Data, null));
        response = yield;

        // Writes the DATA.
        this.write_data();
        response = yield;

        // The assignment is finished, call the callback, and dequeue it.
        assignment.callback(null);
        this._assignments.dequeue();

        // Increments the number of sent emails.
        ++this._total_sent;

        // Goes to the next queued email.
        await this.next();
    }
}