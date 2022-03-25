export class Flags {
    protected _flags: number = 0x00000000;

    public set(mask: number): void {
        this._flags |= mask;
    }

    public clear(mask: number): void {
        this._flags &= ~mask;
    }

    public get(mask: number): number {
        return this._flags & mask;
    }

    public are_set(mask: number): boolean {
        return this.get(mask) === mask;
    }

    public are_clear(mask: number): boolean {
        return this.get(mask) === 0;
    }
}