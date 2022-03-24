import { SmtpSessionState } from "../shared/SmtpSession";
import { SmtpServerMessageTarget } from "./SmtpServerMessageTarget";

const STATE_RESET = SmtpSessionState.Command;

export class SmtpServerSession {
    public invalid_command_count: number = 0;
    public client_domain: string | null = null;
    public from: string | null = null;
    public to: SmtpServerMessageTarget[] | null = null;
    public state: SmtpSessionState = STATE_RESET;

    public constructor() { }

    /**
     * Checks if the to array already contains an target with the given address.
     * @param t the target to check for.
     * @returns if it contains it already.
     */
    public to_contains(t: SmtpServerMessageTarget): boolean {
        if (!this.to) {
            throw new Error('To is empty.');
        }

        return this.to.filter((tt: SmtpServerMessageTarget): boolean => {
            return t.address === tt.address;
        }).length !== 0;
    }

    /**
     * Performs the soft session reset, in this case this simply means clearing some state data.
     */
    public soft_reset(): void {
        this.from = null;
        this.to = null;
    }

    /**
     * Performs the hard reset.
     */
    public hard_reset(): void {
        this.client_domain = null;
        this.from = null;
        this.to = null;
    }
}
