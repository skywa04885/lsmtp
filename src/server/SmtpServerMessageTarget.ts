import { SmtpPolicyError } from "../shared/SmtpError";
import {
  SMTP_EMAIL_REGEX,
  SMTP_RELAY_TARGET_REGEX,
} from "../shared/SmtpRegexes";

export enum SmtpServerMessageTargetType {
  Local = "LOCAL", // If it will be stored locally, the user is local.
  Remote = "REMOTE", // If we need to send the email, only if authenticated.
  Relay = "RELAY", // If we need to relay the email
}

export class SmtpServerMessageTarget {
  public static readonly ADDRESS_SEPARATOR: string = ",";

  /**
   * COnstructs a new SmtpServerMessageTarget.
   * @param type the type of target.
   * @param address the address of target.
   * @param relay_to the possible relay host.
   */
  public constructor(
    public type: SmtpServerMessageTargetType,
    public readonly address: string,
    public readonly relay_to: string | null = null,
    public userdata: any = null
  ) {}

  /**
   * Decodes an address with relay target, for example '@asd.com:user@asd.com'
   * @param raw the raw address.
   * @returns the decoded address.
   */
  protected static decode_address_with_relay_target(
    raw: string
  ): SmtpServerMessageTarget {
    // Trims just to be sure.
    raw = raw.trim();

    // Splits at the colon.
    const raw_splitted: string[] = raw.split(":");
    if (raw_splitted.length !== 2) {
      throw new SyntaxError("Invalid relay syntax.");
    }

    // Gets the relay to and address.
    const [relay_to, address] = raw_splitted;

    // Validates the relay to and the address.
    if (!relay_to.match(SMTP_RELAY_TARGET_REGEX)) {
      throw new SyntaxError("Invalid relay target.");
    } else if (!address.match(SMTP_EMAIL_REGEX)) {
      throw new SyntaxError("Invalid address.");
    }

    // Returns the target.
    return new SmtpServerMessageTarget(
      SmtpServerMessageTargetType.Relay,
      address,
      relay_to,
      null
    );
  }

  /**
   *
   * @param raw the raw target.
   * @returns the decoded target.
   */
  public static decode(raw: string): SmtpServerMessageTarget {
    // Trims just to be sure.
    raw = raw.trim();

    // Checks if there is a comma, if so we need to check for relay info.
    if (!raw.includes(",")) {
      // Checks if we have an ':' if so there still might be an relay target.
      if (!raw.includes(":")) {
        // Checks if it matches the email regexp.
        if (!raw.match(SMTP_EMAIL_REGEX)) {
          throw new SyntaxError(`Address '${raw}' is not valid.`);
        }

        // Returns the mailbox.
        return new SmtpServerMessageTarget(
          SmtpServerMessageTargetType.Local,
          raw
        );
      }

      // Splits at the colon.
      return this.decode_address_with_relay_target(raw);
    }

    // Splits at the comma.
    const raw_splitted: string[] = raw.split(",");
    if (raw_splitted.length !== 2) {
      throw new SyntaxError("Invalid relay syntax.");
    }

    // Gets the relay to and the address.
    const [relay_to, address] = raw_splitted;

    // Checks if the address has a ':' if so it will have higher priority.
    if (address.includes(":")) {
      return this.decode_address_with_relay_target(address);
    }

    // Makes sure the address and relay target are valid.
    if (!relay_to.match(SMTP_RELAY_TARGET_REGEX)) {
      throw new SyntaxError("Invalid relay target.");
    } else if (!address.match(SMTP_EMAIL_REGEX)) {
      throw new SyntaxError("Invalid address.");
    }

    // Returns the result.
    return new SmtpServerMessageTarget(
      SmtpServerMessageTargetType.Relay,
      address,
      relay_to
    );
  }
}
