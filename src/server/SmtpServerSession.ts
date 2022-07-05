import { LINE_SEPARATOR } from "../shared/SmtpConstants";
import { SmtpSessionState } from "../shared/SmtpSession";
import { SmtpUser } from "../shared/SmtpUser";
import { SmtpServerMail, SmtpServerMailMeta } from "./SmtpServerMail";
import { SmtpServerMessageFrom } from "./SmtpServerMessageFrom";
import { SmtpServerMessageTarget } from "./SmtpServerMessageTarget";

const STATE_RESET = SmtpSessionState.Command;

export enum SmtpServerSessionFlag {
  Introduced = 1 << 0, // We've had an EHLO/HELO exchange.
  From = 1 << 1, // We've got one sender.
  To = 1 << 2, // We've got one or more targets.
  BinaryDataTransferMethod = 1 << 3, // We've used BDAT.
  RegularTransferMethod = 1 << 4, // We've used DATA.
  DataTransfered = 1 << 5, // Data Transfer Done.
  Wizard = 1 << 6, // The client is a wizard.
  Authenticated = 1 << 7, // The client is authenticated.
  BinaryDataTransferLast = 1 << 8, // Indicates if this is the last binary data transfer.
}

export enum SmtpServerSessionType {
  SMTP = 'SMTP',
  SMTPS = 'SMTPS',
  ESMTP = 'ESMTP',
  ESMTPS = 'ESMTPS',
}

export class SmtpServerSession {
  public type: SmtpServerSessionType | null = null;
  public invalid_command_count: number = 0;
  public remote_domain: string | null = null;
  public from: SmtpServerMessageFrom | null = null;
  public to: SmtpServerMessageTarget[] | null = null;
  public state: SmtpSessionState = STATE_RESET;
  public data: string | null = null;
  public user: SmtpUser | null = null;

  public flags: number = 0x0000000000;

  public constructor() {}

  /**
   * Checks if the to array already contains an target with the given address.
   * @param t the target to check for.
   * @returns if it contains it already.
   */
  public to_contains(t: SmtpServerMessageTarget): boolean {
    if (!this.to) {
      throw new Error("To is empty.");
    }

    return (
      this.to.filter((tt: SmtpServerMessageTarget): boolean => {
        return t.address === tt.address;
      }).length !== 0
    );
  }

  /**
   * Performs the soft session reset, in this case this simply means clearing some state data.
   */
  public soft_reset(): void {
    // Sets the variables.
    this.from = null;
    this.to = null;
    this.data = null;

    // Updates the flags.
    this.clear_flags(
      SmtpServerSessionFlag.Authenticated |
        SmtpServerSessionFlag.BinaryDataTransferMethod |
        SmtpServerSessionFlag.RegularTransferMethod |
        SmtpServerSessionFlag.DataTransfered |
        SmtpServerSessionFlag.From |
        SmtpServerSessionFlag.To |
        SmtpServerSessionFlag.BinaryDataTransferLast
    );
  }

  /**
   * Performs the hard reset.
   */
  public hard_reset(): void {
    // Sets the variables.
    this.remote_domain = null;
    this.from = null;
    this.to = null;
    this.data = null;
    this.user = null;

    // Updates the flags.
    this.clear_flags(
      SmtpServerSessionFlag.Authenticated |
        SmtpServerSessionFlag.BinaryDataTransferMethod |
        SmtpServerSessionFlag.RegularTransferMethod |
        SmtpServerSessionFlag.DataTransfered |
        SmtpServerSessionFlag.From |
        SmtpServerSessionFlag.To |
        SmtpServerSessionFlag.Wizard |
        SmtpServerSessionFlag.Introduced |
        SmtpServerSessionFlag.BinaryDataTransferLast
    );
  }

  /**
   * Sets the flags in the mask.
   * @param mask the mask to set.
   */
  public set_flags(mask: number): void {
    this.flags |= mask;
  }

  /**
   * Clears the flags of the mask.
   * @param mask the mask.
   */
  public clear_flags(mask: number): void {
    this.flags &= ~mask;
  }

  /**
   * Checks if the given flags are set.
   * @param mask the mask.
   * @returns if they're set.
   */
  public get_flags(mask: number): boolean {
    return (this.flags & mask) === mask;
  }
}
