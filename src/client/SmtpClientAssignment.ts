export interface SmtpClientAssignment {
    // Data.
    from: string,
    to: string[],
    data: string | null,
    // Callbacks.
    executed: (err: Error | null) => void,
    // Linked-List data structure.
    next: SmtpClientAssignment
}
