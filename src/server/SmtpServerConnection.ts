import { EventEmitter } from "stream";
import { Messages } from "../language/Messages";
import { SmtpCapability } from "../shared/SmtpCapability";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import { CAPABILITIES, MAX_INVALID_COMMANDS } from "../shared/SmtpConstants";
import { SmtpMultipleLineRespons } from "../shared/SmtpMutipleLineResponse";
import { SMTP_EMAIL_REGEX } from "../shared/SmtpRegexes";
import { SmtpEnhancedStatusCode, SmtpResponse } from "../shared/SmtpResponse";
import { SmtpSegmentedReader } from "../shared/SmtpSegmentedReader";
import { SmtpSocket } from "../shared/SmtpSocket";
import { SmtpServer } from "./SmtpServer";
import { SmtpServerSession } from "./SmtpServerSession";

/**
 * Parses an email from a MAIL, RCPT argument.
 * @param raw the raw argument.
 * @param expected_keyword the keyword we expect like 'TO' or 'FROM'.
 * @returns The email.
 */
function __mail_rcpt_address_parse(raw: string, expected_keyword: string): string {
    // Splits the raw into segments, and checks if the segment count is valid.
    const segments = raw.split(':');
    if (segments.length !== 2) {
        throw new Error(`Invalid segment count, expected 2 got ${segments.length}`);
    }

    // Gets the email and keyword.
    let [ keyword, email ] = segments;

    // Makes sure the keyword is valid.
    if (keyword.toUpperCase() !== expected_keyword.toUpperCase()) {
        throw new Error(`Keyword mismatch, expected ${expected_keyword.toUpperCase()} got ${keyword.toUpperCase()}`);
    }

    // Makes sure the email has the valid format.
    if (!email.startsWith('<') || !email.endsWith('>')) {
        throw new Error('Email is not enclosed in \'<\' and \'>\'.');
    }

    // Trims the brackets.
    email = email.substring(1, email.length - 1);

    // Validates the email with an regex.
    if (!email.match(SMTP_EMAIL_REGEX)) {
        throw new Error('Email RegExp failed.');
    }

    // Returns the email.
    return email;
}

export class SmtpServerConnection extends EventEmitter {
    public udata: any;

    /**
     * Constructs a new SmtpServerConnection.
     * @param pop_sock the socket.
     */
    public constructor(public readonly server: SmtpServer, public readonly smtp_socket: SmtpSocket, public readonly session: SmtpServerSession) {
        super();

        // Registers the event listeners.
        this.smtp_socket.on('close', (had_error: boolean) => this._event_close(had_error));
    }

    /**
     * Begins the server connection (listens and sends initial line).
     * @returns ourselves.
     */
    public async begin(): Promise<void> {
        // Sends the greeting.
        this.smtp_socket.write(new SmtpResponse(220,
            Messages.greeting._(this)).encode(true));

        // Adds the data event listener.
        let segmented_reader: SmtpSegmentedReader = new SmtpSegmentedReader();
        segmented_reader.on('segment', async (segment: string) => {
            this._handle_line(segment);
        });

        this.smtp_socket.on('data', (chunk: Buffer) => {
            this.smtp_socket.pause();
            segmented_reader.write(chunk.toString('utf-8'));
            this.smtp_socket.resume();
        });
    }

    /**
     * Gets called when the socket closed.
     * @param had_error if there was an error (net-only).
     */
    protected _event_close(had_error: boolean): void {
    }

    /**
     * Handles a single line.
     * @param line the line available for reading.
     */
    protected async _handle_line(line: string): Promise<void> {
        try {
            const command: SmtpCommand = SmtpCommand.decode(line);
            switch (command.type) {
                case SmtpCommandType.Quit:
                    this._handle_quit();
                    break;
                case SmtpCommandType.Noop:
                    this._handle_noop();
                    break;
                case SmtpCommandType.Help:
                    this._handle_help();
                    break;
                case SmtpCommandType.Helo:
                    this._handle_helo(command);
                    break;
                case SmtpCommandType.Ehlo:
                    this._handle_ehlo(command);
                    break;
                case SmtpCommandType.Mail:
                    await this._handle_mail(command);
                    break;
                case SmtpCommandType.Rcpt:
                    await this._handle_rcpt(command);
                    break;
                default:
                    this.smtp_socket.write(new SmtpResponse(502,
                        Messages.general.command_not_implemented(command.type, this),
                        new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                    break;
            }
        } catch (e) {
            // Sends the error response.
            this.smtp_socket.write(new SmtpResponse(500,
                Messages.general.command_invalid(this),
                new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));

            // Close if too many errors.
            if (++this.session.invalid_command_count > MAX_INVALID_COMMANDS) {
                this.smtp_socket.close();
            }
        }
    }

    /**
     * Handles the QUIT command.
     */
    protected _handle_quit(): void {
        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(221, Messages.quit._(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));

        // Closes the socket.
        this.smtp_socket.close();
    }

    /**
     * Handles the NOOP command.
     */
    protected _handle_noop(): void {
        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(221, Messages.quit._(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    /**
     * Handles the HELP command.
     */
    protected _handle_help(): void {
        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(221, Messages.help._(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    /**
     * Handles the HELO command.
     * @param command the command.
     */
    protected _handle_helo(command: SmtpCommand): void {
        // If there are no arguments, send error.
        if (!command.arguments) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.helo.may_not_be_empty(this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // If there are too many arguments, send error.
        if (command.arguments.length != 1) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.helo.invalid_argument(command.argument as string, this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // Updates the state.
        this.session.client_domain = command.arguments[0].trim();

        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(250, Messages.helo._(this)).encode(true));
    }

    /**
     * Handles the EHLO command.
     * @param command the command.
     */
    protected _handle_ehlo(command: SmtpCommand): void {
        // If there are no arguments, send error.
        if (!command.arguments) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.ehlo.may_not_be_empty(this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // If there are too many arguments, send error.
        if (command.arguments.length != 1) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.ehlo.invalid_argument(command.argument as string, this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // Updates the state.
        this.session.client_domain = command.arguments[0].trim();

        // Writes the multiline response.
        SmtpMultipleLineRespons.write_line_callback(this.smtp_socket,
            new SmtpResponse(250, Messages.ehlo._(this)),
            (i: number): { v: string, n: boolean } => {
                const capability: SmtpCapability = CAPABILITIES[i];

                return {
                    v: capability.encode(),
                    n: (i + 1) < CAPABILITIES.length
                };
            });
    }

    /**
     * Handles the mail command.
     * @param command the command.
     */
    protected async _handle_mail(command: SmtpCommand): Promise<void> {
        // If the from is already set, sned the nested error.
        if (this.session.from !== null) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.mail.nested(this),
                new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
            return;
        }

        // If there are no arguments, send error.
        if (!command.arguments) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.mail.may_not_be_empty(this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // Gets the args.
        const args: string[] = command.arguments as string[];
        const address_argument: string = args[0];

        // Tries to read the address, and returns an error if it fails.
        try {
            this.session.from = __mail_rcpt_address_parse(address_argument, 'FROM');
        } catch (e) {
            // Sends the general syntax error.
            this.smtp_socket.write(new SmtpResponse(501, Messages.general.syntax_error(this),
                new SmtpEnhancedStatusCode(5, 5, 2)).encode(true));
            
            // Stops execution.
            return;
        }

        // Sends the success.
        this.smtp_socket.write(new SmtpResponse(250, Messages.mail._(this),
            new SmtpEnhancedStatusCode(2, 1, 0)).encode(true));
    }

    /**
     * Handles the mail command.
     * @param command the command.
     */
     protected async _handle_rcpt(command: SmtpCommand): Promise<void> {
        // If the from is already set, sned the nested error.
        if (this.session.from === null) {
            this.smtp_socket.write(new SmtpResponse(503, Messages.general.bad_sequence_of_commands(this),
                new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
            return;
        }

        // If there are no arguments, send error.
        if (!command.arguments) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.rcpt.may_not_be_empty(this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // Gets the args.
        const args: string[] = command.arguments as string[];
        const address_argument: string = args[0];

        // Tries to read the address, and returns an error if it fails.
        let email: string;
        try {
            email = __mail_rcpt_address_parse(address_argument, 'TO');
        } catch (e) {
            // Sends the general syntax error.
            this.smtp_socket.write(new SmtpResponse(501, Messages.general.syntax_error(this),
                new SmtpEnhancedStatusCode(5, 5, 2)).encode(true));
            
            // Stops execution.
            return;
        }

        // Makes sure the email is not yet in the array.
        if (this.session.to && this.session.to.includes(email)) {
            // Sends the general syntax error.
            this.smtp_socket.write(new SmtpResponse(501, Messages.rcpt.already_recipient(email, this),
                new SmtpEnhancedStatusCode(5, 1, 0)).encode(true));
                   
            // Stops execution.
            return; 
        }

        // Instantiates the array if not existing.
        if (!this.session.to) {
            this.session.to = [];
        }

        // Pushes the email.
        this.session.to.push(email);

        // Sends the success.
        this.smtp_socket.write(new SmtpResponse(250, Messages.rcpt._(this),
            new SmtpEnhancedStatusCode(2, 1, 0)).encode(true));
    }
}