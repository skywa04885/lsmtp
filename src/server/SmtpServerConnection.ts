import { EventEmitter } from "stream";
import { Messages } from "../language/Messages";
import { SmtpAuthType } from "../shared/SmtpAuth";
import { SmtpCapability, SmtpCapabilityType } from "../shared/SmtpCapability";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import { MAX_INVALID_COMMANDS, MAX_MESSAGE_SIZE } from "../shared/SmtpConstants";
import { BadSequenceError, CommandDisabled, InvalidCommandArguments, InvalidCommandError, PolicyError } from "../shared/SmtpError";
import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpMultipleLineRespons } from "../shared/SmtpMutipleLineResponse";
import { SMTP_EMAIL_REGEX } from "../shared/SmtpRegexes";
import { SmtpEnhancedStatusCode, SmtpResponse } from "../shared/SmtpResponse";
import { SmtpDataBuffer } from "../shared/SmtpSegmentedReader";
import { SmtpSessionState } from "../shared/SmtpSession";
import { SmtpSocket } from "../shared/SmtpSocket";
import { SmtpServer } from "./SmtpServer";
import { SmtpServerFeatureFlag } from "./SmtpServerConfig";
import { SmtpServerMessageTarget, SmtpServerMessageTargetType } from "./SmtpServerMessageTarget";
import { SmtpServerSession, SmtpServerSessionFlag } from "./SmtpServerSession";
import { SmtpStream } from "./SmtpServerStream";

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
    protected stream: SmtpStream;
    public udata: any;

    /**
     * Constructs a new SmtpServerConnection.
     * @param pop_sock the socket.
     */
    public constructor(public readonly server: SmtpServer, public readonly smtp_socket: SmtpSocket, public session: SmtpServerSession) {
        // Calls the super.
        super();

        // Creates the stream.
        this.stream = new SmtpStream({}, (data: string) => this.on_binary_data(data), (data: string) => this.on_command(data), (data: string) => this.on_data(data), () => this.on_data_max_reached());
        this.smtp_socket.socket.pipe(this.stream);

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
    }

    /**
     * Gets called when the socket closed.
     * @param had_error if there was an error (net-only).
     */
    protected _event_close(had_error: boolean): void {
    }

    /**
     * Gets called when an command is send.
     * @param data the data.
     */
    protected async on_command(data: string): Promise<void> {
        // Parses the command.
        let command: SmtpCommand;
        try {
            command = SmtpCommand.decode(data);
        } catch (e) {
            if (e instanceof InvalidCommandError) {
                this.smtp_socket.write(new SmtpResponse(550,
                    Messages.general.command_invalid(this),
                    new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                return;
            } else {
                throw e;
            }
        }

        // Handles the command.
        try {
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
                case SmtpCommandType.Bdat:
                    await this._handle_bdat(command);
                    break;
                default:
                    this.smtp_socket.write(new SmtpResponse(502,
                        Messages.general.command_not_implemented(command.type, this),
                        new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                    break;
            }
        } catch (e) {
            if (e instanceof SyntaxError) {
                this.smtp_socket.write(new SmtpResponse(500,
                    Messages.general.syntax_error(this),
                    new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
                this.smtp_socket.close();
            } else if (e instanceof PolicyError) {
                this.smtp_socket.write(new SmtpResponse(550,
                    Messages.general.policy_error(this),
                    new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
            } else if (e instanceof BadSequenceError) {
                this.smtp_socket.write(new SmtpResponse(503, Messages.general.bad_sequence_of_commands(this),
                    new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
            } else if (e instanceof InvalidCommandArguments) {
                this.smtp_socket.write(new SmtpResponse(503, Messages.general.invalid_arguments(this),
                    new SmtpEnhancedStatusCode(5, 5, 4)).encode(true));
            } else if (e instanceof CommandDisabled) {
                this.smtp_socket.write(new SmtpResponse(502, Messages.general.command_disabled(command.type, this),
                    new SmtpEnhancedStatusCode(5, 5, 1)).encode(true));
            } else {
                throw e;
            }

            // Close if too many errors.
            if (++this.session.invalid_command_count > MAX_INVALID_COMMANDS) {
                this.smtp_socket.close();
            }
        }
    }

    /**
     * Gets called when an data reception is done.
     * @param data the data.
     */
    protected async on_data(data: string): Promise<void> {
        // Sets the stream mode back to command.
        this.stream.enter_command_mode();

        // Sets the data in the session.
        this.session.data = data;

        // Sends the response.
        this.smtp_socket.write(new SmtpResponse(250, Messages.data.done(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    /**
     * Gets called when the max data length is reached.
     */
    protected async on_data_max_reached(): Promise<void> {
        // Sends the response and closes the socket.
        this.smtp_socket.write(new SmtpResponse(552, Messages.data.too_large(this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
        this.smtp_socket.close();
    }

    /**
     * Gets called when all bytes from a BDAT command are received.
     * @param data the data.
     */
    protected async on_binary_data(data: string): Promise<void> {
        // Appends the data to the session data.
        this.session.data += data;

        // Enters the command mode.
        this.stream.enter_command_mode();

        // Checks if it is the last, if so set the data transfered flag.
        if (this.session.get_flags(SmtpServerSessionFlag.BinaryDataTransferLast)) {
            // Sets the flag indicating the data transfer is done.
            this.session.set_flags(SmtpServerSessionFlag.DataTransfered);

            // Writes the response of the data transfer end.\
            this.smtp_socket.write(new SmtpResponse(250, Messages.bdat.done(this),
                new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
            return;
        }

        // Sends the response.
        this.smtp_socket.write(new SmtpResponse(250, Messages.bdat._(data.length, this),
            new SmtpEnhancedStatusCode(2, 0, 0)).encode(true));
    }

    /**
     * Handles the bdat command.
     * @param command the command.
     */
    protected async _handle_bdat(command: SmtpCommand): Promise<void> {
        // Checks if the command is disabled.
        if (!this.server.config.feature_enabled(SmtpServerFeatureFlag.Chunking)) {
            throw new CommandDisabled();
        }

        // Checks the flags to make sure we're allowed to execute this.
        if (!this.session.get_flags(SmtpServerSessionFlag.To | SmtpServerSessionFlag.From | SmtpServerSessionFlag.Introduced)) {
            // Not in the correct state yet.
            throw new BadSequenceError();
        } else if (this.session.get_flags(SmtpServerSessionFlag.RegularTransferMethod)) {
            // Using other method.
            throw new BadSequenceError();
        } else if (this.session.get_flags(SmtpServerSessionFlag.DataTransfered)) {
            // Data already transferred.
            throw new BadSequenceError();
        }

        // Makes sure it doesn't have arguments.
        if (!command.arguments) {
            throw new InvalidCommandArguments();
        }

        // Makes sure the number of arguments is not larger than two, else error.
        if (command.arguments.length > 2) {
            throw new InvalidCommandArguments();
        }

        // Checks if we're dealing with a single argument, if so it's not the last.
        if (command.arguments.length === 2) {
            // Checks if the second argument is 'LAST', if not throw syntax error.
            if (command.arguments[1].trim().toUpperCase() !== 'LAST') {
                throw new SyntaxError();
            }

            // Sets the LAST flag.
            this.session.set_flags(SmtpServerSessionFlag.BinaryDataTransferLast);
        }

        // Gets the size to read.
        const size_to_read: number = parseInt(command.arguments[0]);

        // Updates the flags.
        this.session.set_flags(SmtpServerSessionFlag.BinaryDataTransferMethod);

        // Enters the BDAT mode.
        this.stream.enter_bdat_mode(size_to_read);
    }

    /**
     * Handles the data command.
     * @param command the command.
     */
    protected async _handle_data(command: SmtpCommand): Promise<void> {
        // Checks the flags to make sure we're allowed to execute this.
        if (!this.session.get_flags(SmtpServerSessionFlag.To | SmtpServerSessionFlag.From | SmtpServerSessionFlag.Introduced)) {
            // Not in the correct state yet.
            throw new BadSequenceError();
        } else if (this.session.get_flags(SmtpServerSessionFlag.BinaryDataTransferMethod)) {
            // Using other method.
            throw new BadSequenceError();
        } else if (this.session.get_flags(SmtpServerSessionFlag.DataTransfered)) {
            // Data already transferred.
            throw new BadSequenceError();
        }

        // Makes sure it doesn't have arguments.
        if (command.arguments) {
            throw new InvalidCommandArguments();
        }

        // Sets the flags.
        this.session.set_flags(SmtpServerSessionFlag.RegularTransferMethod);

        // Sets the stream mode to data mode.
        this.stream.enter_data_mode(MAX_MESSAGE_SIZE);

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
            throw new InvalidCommandArguments();
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
            throw new InvalidCommandArguments();
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
            throw new InvalidCommandArguments();
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

        // Resets the state.
        this.session.hard_reset();

        // Sets the state flags.
        this.session.set_flags(SmtpServerSessionFlag.Introduced);

        // Sets the state variables.
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

        // Resets the state.
        this.session.hard_reset();

        // Sets the state flags.
        this.session.set_flags(SmtpServerSessionFlag.Introduced);

        // Sets the state variables.
        this.session.client_domain = command.arguments[0].trim();

        // Writes the multiline response.
        SmtpMultipleLineRespons.write_line_callback(this.smtp_socket,
            new SmtpResponse(250, Messages.ehlo._(this)),
            (i: number): { v: string, n: boolean } => {
                const capability: SmtpCapability = this.server.capabilities[i];

                return {
                    v: capability.encode(),
                    n: (i + 1) < this.server.capabilities.length
                };
            });
    }

    /**
     * Handles the mail command.
     * @param command the command.
     */
    protected async _handle_mail(command: SmtpCommand): Promise<void> {
        // Checks the flags to make sure the command is allowed to execute.
        if (!this.session.get_flags(SmtpServerSessionFlag.Introduced)) {
            throw new BadSequenceError();
        } else if (this.session.get_flags(SmtpServerSessionFlag.From)) {
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

        // Sets the from.
        this.session.from = address;

        // Sets the flags.
        this.session.set_flags(SmtpServerSessionFlag.From);

        // Sends the success.
        this.smtp_socket.write(new SmtpResponse(250, Messages.mail._(this),
            new SmtpEnhancedStatusCode(2, 1, 0)).encode(true));
    }

    /**
     * Handles the mail command.
     * @param command the command.
     */
    protected async _handle_rcpt(command: SmtpCommand): Promise<void> {
        // Checks the flags to make sure we're allowed to execute this.
        if (!this.session.get_flags(SmtpServerSessionFlag.Introduced)) {
            throw new BadSequenceError();
        } else if (!this.session.get_flags(SmtpServerSessionFlag.From)) {
            throw new BadSequenceError();
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

        // Pushes the target.
        this.session.to.push(target);

        // Sets the flags (if not already set).
        this.session.set_flags(SmtpServerSessionFlag.To);

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
            throw new InvalidCommandArguments();
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
        // Checks if the command is disabled.
        if (!this.server.config.feature_enabled(SmtpServerFeatureFlag.Vrfy)) {
            throw new CommandDisabled();
        }

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