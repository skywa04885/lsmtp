export interface SmtpClientAssignment {
    // Data.
    from: string;
    to: string[];
    data: string | null;
    // Callbacks.
    callback: (err: Error | null) => void;
}
