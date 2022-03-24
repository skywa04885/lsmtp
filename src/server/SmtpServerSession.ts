import { LINE_SEPARATOR } from "../shared/SmtpConstants";
import { SmtpSessionState } from "../shared/SmtpSession";
import { SmtpServerMessageTarget } from "./SmtpServerMessageTarget";

const STATE_RESET = SmtpSessionState.Command;

export class SmtpServerSession {
    public invalid_command_count: number = 0;
    public client_domain: string | null = null;
    public from: string | null = null;
    public to: SmtpServerMessageTarget[] | null = null;
    public state: SmtpSessionState = STATE_RESET;
    public data: string | null = null;
    public data_transmission_start_us: number | null = null;
    public data_transmission_end_us: number | null = null;

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
     * Appends a line to the data.
     * @param line the line to append.
     */
    public append_data_line(line: string): void {
        if (!this.data) {
            throw new Error('Data transmission is not started yet.');
        }

        this.data += `${line}${LINE_SEPARATOR}`;
    }

    /**
     * Starts the data transmission.
     */
    public start_data_transmission(): void {
        // Sets the state.
        this.state = SmtpSessionState.Data;

        // Initializes the data string.
        this.data = '';

        // Gets the start time.
        const hr_time = process.hrtime();
        this.data_transmission_start_us = hr_time[0] * 1000000 + hr_time[1] / 1000;
    }
    
    /**
     * Ends the data transmission.
     */
    public end_data_transmission(): void {
        // Sets the state.
        this.state = SmtpSessionState.Command;

        // Gets the end time.
        const hr_time = process.hrtime();
        this.data_transmission_end_us = hr_time[0] * 1000000 + hr_time[1] / 1000;
    }

    /**
     * Gets the data transmission speed in bytes/sec.
     */
    public get data_transmission_speed(): number {
        const seconds: number = ((this.data_transmission_end_us as number) - (this.data_transmission_start_us as number)) / 1000000;
        return (this.data as string).length / seconds;
    }

    /**
     * Performs the soft session reset, in this case this simply means clearing some state data.
     */
    public soft_reset(): void {
        this.from = null;
        this.to = null;
        this.data = null;
    }

    /**
     * Performs the hard reset.
     */
    public hard_reset(): void {
        this.client_domain = null;
        this.from = null;
        this.to = null;
        this.data = null;
    }
}
