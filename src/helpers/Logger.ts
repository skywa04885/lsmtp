export enum LoggerLevel {
    TRACE = 'TRACE',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
    FATAL = 'FATAL',
}

export class Logger {
    public constructor(public readonly label: string) { }

    public log(level: LoggerLevel, ...args: any[]): Logger {
        console.log(`${new Date().toLocaleString()} (${level}@${this.label})`, '-', ...args);
        return this;
    }

    public trace(...args: any[]): Logger {
        return this.log(LoggerLevel.TRACE, ...args);
    }

    public info(...args: any[]): Logger {
        return this.log(LoggerLevel.INFO, ...args);
    }

    public warn(...args: any[]): Logger {
        return this.log(LoggerLevel.WARN, ...args);
    }

    public error(...args: any[]): Logger {
        return this.log(LoggerLevel.ERROR, ...args);
    }

    public fatal(...args: any[]): Logger {
        return this.log(LoggerLevel.FATAL, ...args);
    }

}