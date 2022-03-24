export class SmtpServerSession {
    public invalid_command_count: number;
    public client_domain: string | null;
    public from: string | null;
    public to: string[] | null;

    public constructor() {
        this.invalid_command_count = 0;
        this.client_domain = null;
        this.from = null;
        this.to = null;
    }
}
