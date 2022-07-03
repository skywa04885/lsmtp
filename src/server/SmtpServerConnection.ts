import { XOATH2Token } from "lxoauth2/dist/XOAUTH2Token";
import { EventEmitter } from "stream";
import { Messages } from "../language/Messages";
import { SmtpAuthType } from "../shared/SmtpAuth";
import { SmtpCapability, SmtpCapabilityType } from "../shared/SmtpCapability";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import {
  MAX_INVALID_COMMANDS,
  MAX_MESSAGE_SIZE,
} from "../shared/SmtpConstants";
import {
  SmtpBadSequenceError,
  SmtpCommandDisabled,
  SmtpInvalidCommandArguments,
  SmtpInvalidCommandError,
  SmtpPolicyError,
} from "../shared/SmtpError";
import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpMultipleLineResponse } from "../shared/SmtpMutipleLineResponse";
import { SMTP_EMAIL_REGEX } from "../shared/SmtpRegexes";
import { SmtpEnhancedStatusCode, SmtpResponse } from "../shared/SmtpResponse";
import { SmtpSocket } from "../shared/SmtpSocket";
import { SmtpUser } from "../shared/SmtpUser";
import { SmtpServer } from "./SmtpServer";
import { SmtpServerFeatureFlag } from "./SmtpServerConfig";
import { SmtpServerMail, SmtpServerMailMeta } from "./SmtpServerMail";
import { SmtpServerMessageFrom } from "./SmtpServerMessageFrom";
import {
  SmtpServerMessageTarget,
  SmtpServerMessageTargetType,
} from "./SmtpServerMessageTarget";
import { SmtpServerSession, SmtpServerSessionFlag } from "./SmtpServerSession";
import { SmtpStream } from "./SmtpServerStream";

export const enum SmtpServerConnectionLineIdentifier {
  AuthenticationPlain = 0,
}

/**
 * Parses an PLAIN auth string.
 * @param base64 the base64 string.
 * @returns the array with [user, pass].
 */
function __auth_plain_parse(base64: string): string[] {
  // Decodes the base64 string.
  let decoded: string = Buffer.from(base64, "base64").toString("utf-8");

  // Makes sure the first char is '\x00';
  if (!decoded.startsWith("\x00")) {
    throw new SmtpInvalidCommandArguments("Does not start with null terminator.");
  }

  // Removes the first char.
  decoded = decoded.substring(1);

  // Splits the decoded string at '\x00', and makes sure there are two.
  const segments: string[] = decoded.split("\x00");
  if (segments.length !== 2) {
    throw new SmtpInvalidCommandArguments("Invalid segment count.");
  }

  // Returns both segments.
  return segments;
}

/**
 * Parses an email from a MAIL, RCPT argument.
 * @param raw the raw argument.
 * @param expected_keyword the keyword we expect like 'TO' or 'FROM'.
 * @returns The address.
 */
function __mail_rcpt_address_parse(
  raw: string,
  expected_keyword: string
): string {
  // Gets the index of the first colon, we cannot split since relay commands may contain colons too.
  const colon_index: number = raw.indexOf(":");
  if (colon_index === -1) {
    throw new SyntaxError(`Could not find ':' in argument.`);
  }

  // Gets the email and keyword.
  const keyword = raw.substring(0, colon_index);
  let address = raw.substring(colon_index + 1);

  // Makes sure the keyword is valid.
  if (keyword.toUpperCase() !== expected_keyword.toUpperCase()) {
    throw new SmtpInvalidCommandArguments(
      `Keyword mismatch, expected ${expected_keyword.toUpperCase()} got ${keyword.toUpperCase()}`
    );
  }

  // Makes sure the address has the valid format.
  if (!address.startsWith("<") || !address.endsWith(">")) {
    throw new SmtpInvalidCommandArguments(
      `Address '${address}' is not enclosed in \'<\' and \'>\'.`
    );
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
  public constructor(
    public readonly server: SmtpServer,
    public readonly smtp_socket: SmtpSocket,
    public session: SmtpServerSession
  ) {
    // Calls the super.
    super();

    // Creates the stream.
    this.stream = new SmtpStream(
      {},
      (data: string) => this.on_binary_data(data),
      (data: string) => this.on_command(data),
      (data: string) => this.on_data(data),
      () => this.on_data_max_reached(),
      (data: string, identifier: string | number | null) =>
        this.on_line(data, identifier)
    );
    this.smtp_socket.socket!.pipe(this.stream);

    // Registers the event listeners.
    this.smtp_socket.on("close", () => this._event_close());
  }

  /**
   * Begins the server connection (listens and sends initial line).
   * @returns ourselves.
   */
  public async begin(): Promise<void> {
    // Sends the greeting.
    this.smtp_socket.write(
      new SmtpResponse(220, Messages.greeting._(this)).encode(true)
    );
  }

  /**
   * Gets called when the socket closed.
   * @param had_error if there was an error (net-only).
   */
  protected _event_close(): void {}

  /**
   * Constructs the SmtpServerMail class, and returns it to the callback.
   * @returns an possible error from the callee.
   */
  protected async handle_mail(): Promise<Error | null> {
    if (
      !this.session.get_flags(
        SmtpServerSessionFlag.From |
          SmtpServerSessionFlag.To |
          SmtpServerSessionFlag.DataTransfered |
          SmtpServerSessionFlag.Introduced
      )
    ) {
      throw new Error(
        "Handle mail cannot be called without finished transfer."
      );
    }

    // Constructs the meta object.
    const meta: SmtpServerMailMeta = {
      remote_address: this.smtp_socket.address,
      remote_family: this.smtp_socket.family,
      remote_port: this.smtp_socket.port,
      secure: this.smtp_socket.secure,
      remote_domain: this.session.remote_domain as string,
      date: new Date(),
    };

    // Constructs the mail.
    const mail: SmtpServerMail = new SmtpServerMail(
      this.session.data as string,
      this.session.from as SmtpServerMessageFrom,
      this.session.to as SmtpServerMessageTarget[],
      meta
    );

    // Calls the callback.
    return await this.server.config.callbacks.handle_mail(mail, this);
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
      if (e instanceof SmtpInvalidCommandError) {
        this.smtp_socket.write(
          new SmtpResponse(
            550,
            Messages.general.command_invalid(this),
            new SmtpEnhancedStatusCode(5, 5, 1)
          ).encode(true)
        );
      } else {
        throw e;
      }

      // Close if too many errors.
      if (++this.session.invalid_command_count > MAX_INVALID_COMMANDS) {
        this.smtp_socket.close();
      }

      return;
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
        case SmtpCommandType.Auth:
          await this._handle_auth(command);
          break;
        default:
          this.smtp_socket.write(
            new SmtpResponse(
              502,
              Messages.general.command_not_implemented(command.type, this),
              new SmtpEnhancedStatusCode(5, 5, 1)
            ).encode(true)
          );
          break;
      }
    } catch (e) {
      console.log(e);

      if (e instanceof SyntaxError) {
        this.smtp_socket.write(
          new SmtpResponse(
            500,
            Messages.general.syntax_error(this),
            new SmtpEnhancedStatusCode(5, 5, 1)
          ).encode(true)
        );
        this.smtp_socket.close();
      } else if (e instanceof SmtpPolicyError) {
        this.smtp_socket.write(
          new SmtpResponse(
            550,
            Messages.general.policy_error(this),
            new SmtpEnhancedStatusCode(5, 5, 1)
          ).encode(true)
        );
      } else if (e instanceof SmtpBadSequenceError) {
        this.smtp_socket.write(
          new SmtpResponse(
            503,
            Messages.general.bad_sequence_of_commands(this),
            new SmtpEnhancedStatusCode(5, 5, 1)
          ).encode(true)
        );
      } else if (e instanceof SmtpInvalidCommandArguments) {
        this.smtp_socket.write(
          new SmtpResponse(
            503,
            Messages.general.invalid_arguments(this),
            new SmtpEnhancedStatusCode(5, 5, 4)
          ).encode(true)
        );
      } else if (e instanceof SmtpCommandDisabled) {
        this.smtp_socket.write(
          new SmtpResponse(
            502,
            Messages.general.command_disabled(command.type, this),
            new SmtpEnhancedStatusCode(5, 5, 1)
          ).encode(true)
        );
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
   * Gets called when a line is availble.
   * @param data the data.
   * @param identifier the identifier of the line, used to determine how to use it.
   */
  protected async on_line(
    data: string,
    identifier: string | number | null
  ): Promise<void> {
    switch (identifier) {
      //////////////////////////////////
      /// Plain Auth Continuation.
      //////////////////////////////////
      case SmtpServerConnectionLineIdentifier.AuthenticationPlain: {
        // Goes back to command mode.
        this.stream.enter_command_mode();

        // Decodes the base64 value.
        const [user_arg, pass_arg] = __auth_plain_parse(data);

        // Gets the user, and checks if the credentials are correct.
        const user: SmtpUser | null =
          await this.server.config.callbacks.get_user(user_arg, this);
        if (
          !user ||
          !(await this.server.config.callbacks.password_compare(
            pass_arg,
            user.pass
          ))
        ) {
          this.smtp_socket.write(
            new SmtpResponse(
              535,
              Messages.auth.bad_credentials(this),
              new SmtpEnhancedStatusCode(5, 7, 8)
            ).encode(true)
          );
          return;
        }

        // If the credentials are right, set the flags and the user.
        this.session.set_flags(SmtpServerSessionFlag.Authenticated);
        this.session.user = user;

        // Sends the success.
        this.smtp_socket.write(
          new SmtpResponse(
            235,
            Messages.auth._(this),
            new SmtpEnhancedStatusCode(2, 7, 0)
          ).encode(true)
        );

        // Breaks.
        break;
      }
      //////////////////////////////////
      /// Other.
      //////////////////////////////////
      default: {
        // Goes back to command mode.
        this.stream.enter_command_mode();

        // Breaks.
        break;
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

    // Sets the flags.
    this.session.set_flags(SmtpServerSessionFlag.DataTransfered);

    // Sets the data in the session.
    this.session.data = data;

    // We're done.
    const result: Error | null = await this.handle_mail();
    if (result !== null) {
      // TODO: handle this.
    }

    // Performs soft reset.
    this.session.soft_reset();

    // Sends the response.
    this.smtp_socket.write(
      new SmtpResponse(
        250,
        Messages.data.done(this),
        new SmtpEnhancedStatusCode(2, 0, 0)
      ).encode(true)
    );
  }

  /**
   * Gets called when the max data length is reached.
   */
  protected async on_data_max_reached(): Promise<void> {
    // Sends the response and closes the socket.
    this.smtp_socket.write(
      new SmtpResponse(
        552,
        Messages.data.too_large(this),
        new SmtpEnhancedStatusCode(2, 0, 0)
      ).encode(true)
    );
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

      // We're done.
      const result: Error | null = await this.handle_mail();
      if (result !== null) {
        // TODO: handle this.
      }

      // Performs soft reset.
      this.session.soft_reset();

      // Writes the response of the data transfer end.
      this.smtp_socket.write(
        new SmtpResponse(
          250,
          Messages.bdat.done(this),
          new SmtpEnhancedStatusCode(2, 0, 0)
        ).encode(true)
      );
      return;
    }

    // Sends the response.
    this.smtp_socket.write(
      new SmtpResponse(
        250,
        Messages.bdat._(data.length, this),
        new SmtpEnhancedStatusCode(2, 0, 0)
      ).encode(true)
    );
  }

  /**
   * Handles the AUTH command.
   * @param command the command.
   */
  protected async _handle_auth(command: SmtpCommand): Promise<void> {
    // Checks if the command is disabled.
    if (!this.server.config.feature_enabled(SmtpServerFeatureFlag.Auth)) {
      throw new SmtpCommandDisabled();
    }

    // Makes sure we're allowed to perform this command.
    if (
      !this.session.get_flags(SmtpServerSessionFlag.Introduced) ||
      this.session.get_flags(SmtpServerSessionFlag.From) ||
      this.session.get_flags(SmtpServerSessionFlag.Authenticated)
    ) {
      throw new SmtpBadSequenceError();
    }

    // Checks if there are arguments at all.
    if (!command.arguments || command.arguments.length === 0) {
      throw new SmtpInvalidCommandArguments("No arguments.");
    }

    // Gets the first argument, indicating the mechanism.
    const mechanism: string = command.arguments[0].trim().toUpperCase();

    // Checks the type of mechanism.
    switch (mechanism) {
      case SmtpAuthType.PLAIN: {
        // Makes sure there are two arguments, if not this means that we need to wait for another
        //  line to have the auth value (super retarded).
        if (command.arguments.length !== 2) {
          this.stream.enter_line_mode(
            SmtpServerConnectionLineIdentifier.AuthenticationPlain
          );
          break;
        }

        // Gets the second argument, and decodes the Base64 value.
        const [user_arg, pass_arg] = __auth_plain_parse(command.arguments[1]);

        // Gets the user, and checks if the credentials are correct.
        const user: SmtpUser | null =
          await this.server.config.callbacks.get_user(user_arg, this);
        if (
          !user ||
          !(await this.server.config.callbacks.password_compare(
            pass_arg,
            user.pass
          ))
        ) {
          this.smtp_socket.write(
            new SmtpResponse(
              535,
              Messages.auth.bad_credentials(this),
              new SmtpEnhancedStatusCode(5, 7, 8)
            ).encode(true)
          );
          return;
        }

        // If the credentials are right, set the flags and the user.
        this.session.set_flags(SmtpServerSessionFlag.Authenticated);
        this.session.user = user;

        // Sends the success.
        this.smtp_socket.write(
          new SmtpResponse(
            235,
            Messages.auth._(this),
            new SmtpEnhancedStatusCode(2, 7, 0)
          ).encode(true)
        );

        break;
      }
      case SmtpAuthType.XOAUTH2: {
        // Makes sure there are two arguments.
        if (command.arguments.length !== 2) {
          throw new SmtpInvalidCommandArguments();
        }

        // Parses the XOAUTH2 token.
        let token: XOATH2Token;
        try {
          token = XOATH2Token.decode(command.arguments[1].trim());
        } catch (e) {
          throw new SmtpInvalidCommandArguments((e as Error).message);
        }

        // Validates the token.
        const user: SmtpUser | null =
          await this.server.config.callbacks.verify_xoath2(token, this);
        if (!user) {
          this.smtp_socket.write(
            new SmtpResponse(
              535,
              Messages.auth.bad_credentials(this),
              new SmtpEnhancedStatusCode(5, 7, 8)
            ).encode(true)
          );
          return;
        }

        // If the credentials are right, set the flags and the user.
        this.session.set_flags(SmtpServerSessionFlag.Authenticated);
        this.session.user = user;

        // Sends the success.
        this.smtp_socket.write(
          new SmtpResponse(
            235,
            Messages.auth._(this),
            new SmtpEnhancedStatusCode(2, 7, 0)
          ).encode(true)
        );
        break;
      }

      default:
        throw new SmtpInvalidCommandArguments();
    }
  }

  /**
   * Handles the bdat command.
   * @param command the command.
   */
  protected async _handle_bdat(command: SmtpCommand): Promise<void> {
    // Checks if the command is disabled.
    if (!this.server.config.feature_enabled(SmtpServerFeatureFlag.Chunking)) {
      throw new SmtpCommandDisabled();
    }

    // Checks the flags to make sure we're allowed to execute this.
    if (
      !this.session.get_flags(
        SmtpServerSessionFlag.To |
          SmtpServerSessionFlag.From |
          SmtpServerSessionFlag.Introduced
      )
    ) {
      // Not in the correct state yet.
      throw new SmtpBadSequenceError();
    } else if (
      this.session.get_flags(SmtpServerSessionFlag.RegularTransferMethod)
    ) {
      // Using other method.
      throw new SmtpBadSequenceError();
    } else if (this.session.get_flags(SmtpServerSessionFlag.DataTransfered)) {
      // Data already transferred.
      throw new SmtpBadSequenceError();
    }

    // Makes sure it doesn't have arguments.
    if (!command.arguments) {
      throw new SmtpInvalidCommandArguments();
    }

    // Makes sure the number of arguments is not larger than two, else error.
    if (command.arguments.length > 2) {
      throw new SmtpInvalidCommandArguments();
    }

    // Checks if we're dealing with a single argument, if so it's not the last.
    if (command.arguments.length === 2) {
      // Checks if the second argument is 'LAST', if not throw syntax error.
      if (command.arguments[1].trim().toUpperCase() !== "LAST") {
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
    if (
      !this.session.get_flags(
        SmtpServerSessionFlag.To |
          SmtpServerSessionFlag.From |
          SmtpServerSessionFlag.Introduced
      )
    ) {
      // Not in the correct state yet.
      throw new SmtpBadSequenceError();
    } else if (
      this.session.get_flags(SmtpServerSessionFlag.BinaryDataTransferMethod)
    ) {
      // Using other method.
      throw new SmtpBadSequenceError();
    } else if (this.session.get_flags(SmtpServerSessionFlag.DataTransfered)) {
      // Data already transferred.
      throw new SmtpBadSequenceError();
    }

    // Makes sure it doesn't have arguments.
    if (command.arguments) {
      throw new SmtpInvalidCommandArguments();
    }

    // Sets the flags.
    this.session.set_flags(SmtpServerSessionFlag.RegularTransferMethod);

    // Sets the stream mode to data mode.
    this.stream.enter_data_mode(this.server.config.size_limit);

    // Sends the signal to start.
    this.smtp_socket.write(
      new SmtpResponse(
        354,
        Messages.data._(this),
        new SmtpEnhancedStatusCode(2, 0, 0)
      ).encode(true)
    );
  }

  /**
   * Handles the QUIT command.
   * @param command the command.
   */
  protected async _handle_quit(command: SmtpCommand): Promise<void> {
    // Makes sure it doesn't have arguments.
    if (command.arguments) {
      throw new SmtpInvalidCommandArguments();
    }

    // Writes the response.
    this.smtp_socket.write(
      new SmtpResponse(
        221,
        Messages.quit._(this),
        new SmtpEnhancedStatusCode(2, 0, 0)
      ).encode(true)
    );

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
      throw new SmtpInvalidCommandArguments();
    }

    // Writes the response.
    this.smtp_socket.write(
      new SmtpResponse(
        221,
        Messages.quit._(this),
        new SmtpEnhancedStatusCode(2, 0, 0)
      ).encode(true)
    );
  }

  /**
   * Handles the HELP command.
   * @param command the command.
   */
  protected async _handle_help(command: SmtpCommand): Promise<void> {
    // Makes sure it doesn't have arguments.
    if (command.arguments) {
      throw new SmtpInvalidCommandArguments();
    }

    // Writes the response.
    this.smtp_socket.write(
      new SmtpResponse(
        221,
        Messages.help._(this),
        new SmtpEnhancedStatusCode(2, 0, 0)
      ).encode(true)
    );
  }

  /**
   * Handles the HELO command.
   * @param command the command.
   */
  protected async _handle_helo(command: SmtpCommand): Promise<void> {
    // If there are no arguments, send error.
    if (!command.arguments) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.helo.may_not_be_empty(this),
          new SmtpEnhancedStatusCode(5, 5, 4)
        ).encode(true)
      );
      this.smtp_socket.close();
      return;
    }

    // If there are too many arguments, send error.
    if (command.arguments.length != 1) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.helo.invalid_argument(command.argument as string, this),
          new SmtpEnhancedStatusCode(5, 5, 4)
        ).encode(true)
      );
      this.smtp_socket.close();
      return;
    }

    // Resets the state.
    this.session.hard_reset();

    // Sets the state flags.
    this.session.set_flags(SmtpServerSessionFlag.Introduced);

    // Sets the state variables.
    this.session.remote_domain = command.arguments[0].trim();

    // Writes the response.
    this.smtp_socket.write(
      new SmtpResponse(250, Messages.helo._(this)).encode(true)
    );
  }

  /**
   * Handles the EHLO command.
   * @param command the command.
   */
  protected async _handle_ehlo(command: SmtpCommand): Promise<void> {
    // If there are no arguments, send error.
    if (!command.arguments) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.ehlo.may_not_be_empty(this),
          new SmtpEnhancedStatusCode(5, 5, 4)
        ).encode(true)
      );
      this.smtp_socket.close();
      return;
    }

    // If there are too many arguments, send error.
    if (command.arguments.length != 1) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.ehlo.invalid_argument(command.argument as string, this),
          new SmtpEnhancedStatusCode(5, 5, 4)
        ).encode(true)
      );
      this.smtp_socket.close();
      return;
    }

    // Resets the state.
    this.session.hard_reset();

    // Sets the state flags.
    this.session.set_flags(SmtpServerSessionFlag.Introduced);

    // Sets the state variables.
    this.session.remote_domain = command.arguments[0].trim();

    // Writes the multiline response.
    SmtpMultipleLineResponse.write_line_callback(
      this.smtp_socket,
      new SmtpResponse(250, Messages.ehlo._(this)),
      (i: number): { v: string; n: boolean } => {
        const capability: SmtpCapability = this.server.capabilities[i];

        return {
          v: capability.encode(),
          n: i + 1 < this.server.capabilities.length,
        };
      }
    );
  }

  /**
   * Handles the mail command.
   * @param command the command.
   */
  protected async _handle_mail(command: SmtpCommand): Promise<void> {
    // Checks the flags to make sure the command is allowed to execute.
    if (!this.session.get_flags(SmtpServerSessionFlag.Introduced)) {
      throw new SmtpBadSequenceError();
    } else if (this.session.get_flags(SmtpServerSessionFlag.From)) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.mail.nested(this),
          new SmtpEnhancedStatusCode(5, 5, 1)
        ).encode(true)
      );
      return;
    }

    // If there are no arguments, send error.
    if (!command.arguments) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.mail.may_not_be_empty(this),
          new SmtpEnhancedStatusCode(5, 5, 4)
        ).encode(true)
      );
      this.smtp_socket.close();
      return;
    }

    // Gets the args.
    const args: string[] = command.arguments as string[];
    const address_argument: string = args[0];

    // Gets the address.
    const address: string = __mail_rcpt_address_parse(address_argument, "FROM");

    // Validates the email with an regex.
    if (!address.match(SMTP_EMAIL_REGEX)) {
      throw new SyntaxError("Email RegExp failed.");
    }

    // Handles the from event, and checks if we're dealing with an error
    //  if so we will return the error.
    const handlerResult: SmtpServerMessageFrom | Error = await this.server.config.callbacks.handle_mail_from(address, this);
    if (handlerResult instanceof Error) {
      throw handlerResult;
    }

    // Sets the from.
    this.session.from = handlerResult;

    // Sets the flags.
    this.session.set_flags(SmtpServerSessionFlag.From);

    // Sends the success.
    this.smtp_socket.write(
      new SmtpResponse(
        250,
        Messages.mail._(this),
        new SmtpEnhancedStatusCode(2, 1, 0)
      ).encode(true)
    );
  }

  /**
   * Handles the mail command.
   * @param command the command.
   */
  protected async _handle_rcpt(command: SmtpCommand): Promise<void> {
    // Checks the flags to make sure we're allowed to execute this.
    if (!this.session.get_flags(SmtpServerSessionFlag.Introduced)) {
      throw new SmtpBadSequenceError();
    } else if (!this.session.get_flags(SmtpServerSessionFlag.From)) {
      throw new SmtpBadSequenceError();
    }

    // If there are no arguments, send error.
    if (!command.arguments) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.rcpt.may_not_be_empty(this),
          new SmtpEnhancedStatusCode(5, 5, 4)
        ).encode(true)
      );
      this.smtp_socket.close();
      return;
    }

    // Gets the args, and reads the address from them.
    const args: string[] = command.arguments as string[];
    const address = __mail_rcpt_address_parse(args[0], "TO");

    // Parses the target, and if it is relay, throw a policy error.
    const target: SmtpServerMessageTarget =
      SmtpServerMessageTarget.decode(address);
    if (target.type === SmtpServerMessageTargetType.Relay) {
      throw new SmtpPolicyError("Relaying is not supported.");
    }

    // Handles the target, this will perform extra validation (if needed).
    const handlerResult: Error | null = await this.server.config.callbacks.handle_rcpt_to(target, this);
    if (handlerResult !== null) {
      throw handlerResult;
    }

    // Makes sure the email is not yet in the array.
    if (this.session.to && this.session.to_contains(target)) {
      // Sends the general syntax error.
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.rcpt.already_recipient(target.address, this),
          new SmtpEnhancedStatusCode(5, 1, 0)
        ).encode(true)
      );

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
    this.smtp_socket.write(
      new SmtpResponse(
        250,
        Messages.rcpt._(this),
        new SmtpEnhancedStatusCode(2, 1, 0)
      ).encode(true)
    );
  }

  /**
   * Handles the RSET command (soft-reset).
   * @param command the command.
   */
  protected async _handle_rset(command: SmtpCommand) {
    // Makes sure it doesn't have arguments.
    if (command.arguments) {
      throw new SmtpInvalidCommandArguments();
    }

    // Resets the state.
    this.session.soft_reset();

    // Sends the ok response.
    this.smtp_socket.write(
      new SmtpResponse(
        250,
        Messages.rset._(this),
        new SmtpEnhancedStatusCode(2, 1, 0)
      ).encode(true)
    );
  }

  /**
   * Handles the VRFY command.
   * @param command the command.
   */
  public async _handle_vrfy(command: SmtpCommand): Promise<void> {
    // Checks if the command is disabled.
    if (!this.server.config.feature_enabled(SmtpServerFeatureFlag.Vrfy)) {
      throw new SmtpCommandDisabled();
    }

    // Makes sure there are arguments.
    if (!command.arguments) {
      this.smtp_socket.write(
        new SmtpResponse(
          501,
          Messages.vrfy.may_not_be_empty(this),
          new SmtpEnhancedStatusCode(5, 5, 4)
        ).encode(true)
      );
      this.smtp_socket.close();
      return;
    }

    // Gets the mailbox or name.
    let mailbox_or_name: string = command.arguments[0];

    // Checks if we're dealing with a mailbox or name.
    const opening_bracket_index: number = mailbox_or_name.indexOf("<");
    const closing_bracket_index: number = mailbox_or_name.lastIndexOf(">");
    if (opening_bracket_index !== -1 && closing_bracket_index !== -1) {
      // Mailbox
      mailbox_or_name = mailbox_or_name.substring(
        1,
        mailbox_or_name.length - 1
      );

      // Validates the mailbox.
      if (!mailbox_or_name.match(SMTP_EMAIL_REGEX)) {
        this.smtp_socket.write(
          new SmtpResponse(
            501,
            Messages.general.syntax_error(this),
            new SmtpEnhancedStatusCode(5, 1, 3)
          ).encode(true)
        );
        this.smtp_socket.close();
        return;
      }

      // Verifies the mailbox.
      const mailbox: SmtpMailbox | null =
        await this.server.config.callbacks.verify_mailbox(
          mailbox_or_name,
          this
        );

      // Sends the response.
      if (!mailbox) {
        this.smtp_socket.write(
          new SmtpResponse(
            550,
            Messages.vrfy.mailbox_unavailable(this),
            new SmtpEnhancedStatusCode(5, 1, 2)
          ).encode(true)
        );
        return;
      }

      this.smtp_socket.write(
        new SmtpResponse(
          250,
          Messages.vrfy._(mailbox, this),
          new SmtpEnhancedStatusCode(2, 1, 5)
        ).encode(true)
      );
      return;
    } else if (opening_bracket_index !== -1 || closing_bracket_index !== -1) {
      throw new SyntaxError("Closing or opening bracket missing!");
    }

    // We're dealing with a name.
    const mailboxes: SmtpMailbox[] =
      await this.server.config.callbacks.verify_name(mailbox_or_name, this);

    // Checks how to respond.
    if (mailboxes.length === 0) {
      this.smtp_socket.write(
        new SmtpResponse(
          550,
          Messages.vrfy.mailbox_unavailable(this),
          new SmtpEnhancedStatusCode(5, 1, 2)
        ).encode(true)
      );
    } else if (mailboxes.length === 1) {
      this.smtp_socket.write(
        new SmtpResponse(
          250,
          Messages.vrfy._(mailboxes[0], this),
          new SmtpEnhancedStatusCode(2, 1, 5)
        ).encode(true)
      );
    } else {
      this.smtp_socket.write(
        new SmtpResponse(
          550,
          Messages.vrfy.ambiguous(mailbox_or_name, this),
          new SmtpEnhancedStatusCode(5, 1, 4)
        ).encode(true)
      );
    }
  }
}
