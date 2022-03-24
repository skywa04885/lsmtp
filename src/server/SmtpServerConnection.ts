import { EventEmitter } from "stream";
import { Messages } from "../language/Messages";
import { SmtpCapability } from "../shared/SmtpCapability";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import { CAPABILITIES, MAX_INVALID_COMMANDS } from "../shared/SmtpConstants";
import { BadSequenceError, InvalidCommandError, PolicyError } from "../shared/SmtpError";
import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpMultipleLineRespons } from "../shared/SmtpMutipleLineResponse";
import { SMTP_EMAIL_REGEX } from "../shared/SmtpRegexes";
import { SmtpEnhancedStatusCode, SmtpResponse } from "../shared/SmtpResponse";
import { SmtpSegmentedReader } from "../shared/SmtpSegmentedReader";
import { SmtpSessionState } from "../shared/SmtpSession";
import { SmtpSocket } from "../shared/SmtpSocket";
import { SmtpServer } from "./SmtpServer";
import { SmtpServerMessageTarget, SmtpServerMessageTargetType } from "./SmtpServerMessageTarget";
import { SmtpServerSession } from "./SmtpServerSession";

/**
 * Parses an email from a MAIL, RCPT argument.
 * @param raw the raw argument.
 * @param expected_keyword the keyword we expect like 'TO' or 'FROM'.
 * @returns The address.
 */
function __mail_rcpt_address_parse(raw: string, expected_keyword: string): string {
    // Gets the index of the first colon, we cannot split since relay commands may contain colons too.
    const colon_index: number = raw.indexOf(':');
    if (colon_index === -1) {
        throw new SyntaxError(`Could not find ':' in argument.`);
    }

    // Gets the email and keyword.
    const keyword = raw.substring(0, colon_index);
    let address = raw.substring(colon_index + 1);

    // Makes sure the keyword is valid.
    if (keyword.toUpperCase() !== expected_keyword.toUpperCase()) {
        throw new SyntaxError(`Keyword mismatch, expected ${expected_keyword.toUpperCase()} got ${keyword.toUpperCase()}`);
    }

    // Makes sure the address has the valid format.
    if (!address.startsWith('<') || !address.endsWith('>')) {
        throw new SyntaxError('Address is not enclosed in \'<\' and \'>\'.');
    }

    // Trims the brackets.
    address = address.substring(1, address.length - 1);

    // Returns the email.
    return address;
}

export class SmtpServerConnection extends EventEmitter {
    public udata: any;

    /**
     * Constructs a new SmtpServerConnection.
     * @param pop_sock the socket.
     */
    public constructor(public readonly server: SmtpServer, public readonly smtp_socket: SmtpSocket, public session: SmtpServerSession) {
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
        switch (this.session.state) {
            ///////////////////////////////////////
            // [Switch] Data State
            case SmtpSessionState.Data: {
                await this._handle_data_line(line);
                break;
            }
            ///////////////////////////////////////
            ///////////////////////////////////////
            // [Switch] Command State
            ///////////////////////////////////////
            case SmtpSessionState.Command: {
                try {
                    const command: SmtpCommand = SmtpCommand.decode(line);
                    switch (command.type) {
                        case SmtpCommandType.Quit:
                            await this._handle_quit(command);
                            break;
                        case SmtpCommandType.Noop:
                            this._handle_noop(command);
                            break;
                        case SmtpCommandType.Help:
                            await this._handle_help(command);
                            break;
                        case SmtpCommandType.Helo:
                            await this._handle_helo(command);
                            break;
                        case SmtpCommandType.Ehlo:
                            await this._handle_ehlo(command);
                            break;
                        case SmtpCommandType.Mail:
                            await this._handle_mail(command);
                            break;
                        case SmtpCommandType.Rcpt:
                            await this._handle_rcpt(command);
                            break;
                        case SmtpCommandType.Rcpt:
                            await this._handle_rset(command);
                            break;
                        case SmtpCommandType.Vrfy:
                            await this._handle_vrfy(command);
                            break;
                        case SmtpCommandType.Data:
                            await this._handle_data(command);
                            break;
                        case SmtpCommandType.Rset:
                            await this._handle_rset(command);
                            break;
                        default:
                            this.smtp_socket.write(new SmtpResponse(502,
                                Messages.general.command_not_implemented(command.type, this),
                                new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                            break;
                    }
                } catch (e) {
                    if (this.server.config.verbose) {
                        console.error(e);
                    }
        
                    if (e instanceof SyntaxError) {
                        this.smtp_socket.write(new SmtpResponse(500,
                            Messages.general.syntax_error(this),
                            new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                        this.smtp_socket.close();
                    } else if (e instanceof PolicyError) {
                        this.smtp_socket.write(new SmtpResponse(550,
                            Messages.general.policy_error(this),
                            new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                    } else if (e instanceof InvalidCommandError) {
                        this.smtp_socket.write(new SmtpResponse(550,
                            Messages.general.command_invalid(this),
                            new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                    } else if (e instanceof BadSequenceError) {
                        this.smtp_socket.write(new SmtpResponse(503, Messages.general.bad_sequence_of_commands(this),
                            new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                    }
        
                    // Close if too many errors.
                    if (++this.session.invalid_command_count > MAX_INVALID_COMMANDS) {
                        this.smtp_socket.close();
                    }
                }
            }
        }
    }

    /**
     * Handles a single line of data.
     * @param line the line of data.
     */
    protected async _handle_data_line(line: string): Promise<void> {
        // Checks if we're dealing with an escaped dot or regular data.
        if (line === '..') { // Line with escaped dot, remove one dot and add to body.
            this.session.append_data_line('.');
            return;
        } else if (line !== '.') { // Regular Data.
            this.session.append_data_line(line);
            return;
        }

        // Ends the data transmission.
        this.session.end_data_transmission();

        // Sends the ok.
        this.smtp_socket.write(new SmtpResponse(250, Messages.data.done(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    protected async _handle_data(command: SmtpCommand): Promise<void> {
        // Makes sure it doesn't have arguments.
        if (command.arguments) {
            throw new SyntaxError(`${SmtpCommandType.Data} has no arguments.`);
        }

        // Make sure there is no data yet.
        if (this.session.data !== null || !this.session.from || !this.session.to || !this.session.client_domain) {
            throw new BadSequenceError();
        }

        // Starts the data transmission.
        this.session.start_data_transmission();

        // Sends the signal to start.
        this.smtp_socket.write(new SmtpResponse(354, Messages.data._(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    /**
     * Handles the QUIT command.
     * @param command the command.
     */
    protected async _handle_quit(command: SmtpCommand): Promise<void> {
        // Makes sure it doesn't have arguments.
        if (command.arguments) {
            throw new SyntaxError(`${SmtpCommandType.Quit} has no arguments.`);
        }

        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(221, Messages.quit._(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));

        // Closes the socket.
        this.smtp_socket.close();
    }

    /**
     * Handles the NOOP command.
     * @param command the command.
     */
    protected async _handle_noop(command: SmtpCommand): Promise<void> {
        // Makes sure it doesn't have arguments.
        if (command.arguments) {
            throw new SyntaxError(`${SmtpCommandType.Noop} has no arguments.`);
        }

        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(221, Messages.quit._(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    /**
     * Handles the HELP command.
     * @param command the command.
     */
    protected async _handle_help(command: SmtpCommand): Promise<void> {
        // Makes sure it doesn't have arguments.
        if (command.arguments) {
            throw new SyntaxError(`${SmtpCommandType.Help} has no arguments.`);
        }

        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(221, Messages.help._(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    /**
     * Handles the HELO command.
     * @param command the command.
     */
    protected async _handle_helo(command: SmtpCommand): Promise<void> {
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
        this.session.hard_reset();
        this.session.client_domain = command.arguments[0].trim();

        // Writes the response.
        this.smtp_socket.write(new SmtpResponse(250, Messages.helo._(this)).encode(true));
    }

    /**
     * Handles the EHLO command.
     * @param command the command.
     */
    protected async _handle_ehlo(command: SmtpCommand): Promise<void> {
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
        this.session.hard_reset();
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
        // Makes sure EHLO/HELO is executed.
        if (!this.session.client_domain) {
            throw new BadSequenceError(`${SmtpCommandType.Ehlo}/${SmtpCommandType.Helo} must be executed first!`);
        }

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

        // Gets the address.
        const address: string = __mail_rcpt_address_parse(address_argument, 'FROM');

        // Validates the email with an regex.
        if (!address.match(SMTP_EMAIL_REGEX)) {
            throw new SyntaxError('Email RegExp failed.');
        }

        // Sets the address.
        this.session.from = address;

        // Sends the success.
        this.smtp_socket.write(new SmtpResponse(250, Messages.mail._(this),
            new SmtpEnhancedStatusCode(2, 1, 0)).encode(true));
    }

    /**
     * Handles the mail command.
     * @param command the command.
     */
    protected async _handle_rcpt(command: SmtpCommand): Promise<void> {
        // Makes sure EHLO/HELO is executed.
        if (!this.session.client_domain) {
            throw new BadSequenceError(`${SmtpCommandType.Ehlo}/${SmtpCommandType.Helo} must be executed first!`);
        }

        // If the from is already set, sned the nested error.
        if (this.session.from === null) {
            throw new BadSequenceError(`${SmtpCommandType.Mail} must be executed first!`);
        }

        // If there are no arguments, send error.
        if (!command.arguments) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.rcpt.may_not_be_empty(this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // Gets the args, and reads the address from them.
        const args: string[] = command.arguments as string[];
        const address = __mail_rcpt_address_parse(args[0], 'TO');

        // Parses the target, and if it is relay, throw a policy error.
        const target: SmtpServerMessageTarget = SmtpServerMessageTarget.decode(address);
        if (target.type === SmtpServerMessageTargetType.Relay) {
            throw new PolicyError('Relaying is not supported.');
        }

        // Makes sure the email is not yet in the array.
        if (this.session.to && this.session.to_contains(target)) {
            // Sends the general syntax error.
            this.smtp_socket.write(new SmtpResponse(501, Messages.rcpt.already_recipient(target.address, this),
                new SmtpEnhancedStatusCode(5, 1, 0)).encode(true));

            // Stops execution.
            return;
        }

        // Instantiates the array if not existing.
        if (!this.session.to) {
            this.session.to = [];
        }

        // Pushes the email.
        this.session.to.push(target);

        // Sends the success.
        this.smtp_socket.write(new SmtpResponse(250, Messages.rcpt._(this),
            new SmtpEnhancedStatusCode(2, 1, 0)).encode(true));
    }

    /**
     * Handles the RSET command (soft-reset).
     * @param command the command.
     */
    protected async _handle_rset(command: SmtpCommand) {
        // Makes sure it doesn't have arguments.
        if (command.arguments) {
            throw new SyntaxError(`${SmtpCommandType.Rset} has no arguments.`);
        }

        // Resets the state.
        this.session.soft_reset();

        // Sends the ok response.
        this.smtp_socket.write(new SmtpResponse(250, Messages.rset._(this),
            new SmtpEnhancedStatusCode(2, 1, 0)).encode(true));
    }

    /**
     * Handles the VRFY command.
     * @param command the command.
     */
    public async _handle_vrfy(command: SmtpCommand): Promise<void> {
        // Makes sure there are arguments.
        if (!command.arguments) {
            this.smtp_socket.write(new SmtpResponse(501, Messages.vrfy.may_not_be_empty(this),
                new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            this.smtp_socket.close();
            return;
        }

        // Gets the mailbox or name.
        let mailbox_or_name: string = command.arguments[0];

        // Checks if we're dealing with a mailbox or name.
        const opening_bracket_index: number = mailbox_or_name.indexOf('<');
        const closing_bracket_index: number = mailbox_or_name.lastIndexOf('>');
        if (opening_bracket_index !== -1 && closing_bracket_index !== -1) { // Mailbox
            mailbox_or_name = mailbox_or_name.substring(1, mailbox_or_name.length - 1);

            // Validates the mailbox.
            if (!mailbox_or_name.match(SMTP_EMAIL_REGEX)) {
                this.smtp_socket.write(new SmtpResponse(501, Messages.general.syntax_error(this),
                    new SmtpEnhancedStatusCode(5, 1, 3)).encode(true));
                this.smtp_socket.close();
                return;
            }

            // Verifies the mailbox.
            const mailbox: SmtpMailbox | null = await this.server.config.verify_mailbox(mailbox_or_name, this);

            // Sends the response.
            if (!mailbox) {
                this.smtp_socket.write(new SmtpResponse(550, Messages.vrfy.mailbox_unavailable(this),
                    new SmtpEnhancedStatusCode(5, 1, 2)).encode(true));
                return;
            }

            this.smtp_socket.write(new SmtpResponse(250, Messages.vrfy._(mailbox, this),
                new SmtpEnhancedStatusCode(2, 1, 5)).encode(true));

            return;
        } else if (opening_bracket_index !== -1 || closing_bracket_index !== -1) {
            throw new SyntaxError('Closing or opening bracket missing!');
        }

        // We're dealing with a name.
        const mailboxes: SmtpMailbox[] = await this.server.config.verify_name(mailbox_or_name, this);

        // Checks how to respond.
        if (mailboxes.length === 0) {
            this.smtp_socket.write(new SmtpResponse(550, Messages.vrfy.mailbox_unavailable(this),
                new SmtpEnhancedStatusCode(5, 1, 2)).encode(true));
        } else if (mailboxes.length === 1) {
            this.smtp_socket.write(new SmtpResponse(250, Messages.vrfy._(mailboxes[0], this),
                new SmtpEnhancedStatusCode(2, 1, 5)).encode(true));
        } else {
            this.smtp_socket.write(new SmtpResponse(550, Messages.vrfy.ambiguous(mailbox_or_name, this),
                new SmtpEnhancedStatusCode(5, 1, 4)).encode(true));
        }
    }
}