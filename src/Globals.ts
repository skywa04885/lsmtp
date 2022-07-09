import os from "os";

export class Globals {
  protected _hostname: string;

  protected constructor() {
    this._domain = process.env.DOMAIN ?? "localhost";
    this._hostname = os.hostname.name;
  }

  protected static _instance: Globals | undefined;

  public static get instance(): Globals {
    if (!this._instance) {
      this._instance = new Globals();
    }

    return this._instance;
  }

  protected _domain: string;

  public get domain(): string {
    return this._domain;
  }
}
