import { dim } from "./colors.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * A spinner for the wait, which on a large contract is ten seconds or more.
 *
 * Everything goes to stderr so that `nite-zk profile --json > out.json` stays
 * clean, and it disables itself when stderr is not a terminal so CI logs do not
 * fill with redraw frames.
 */
export class Progress {
  private timer: NodeJS.Timeout | undefined;
  private frame = 0;
  private label = "";
  private readonly active: boolean;

  constructor(enabled = true) {
    this.active =
      enabled &&
      process.stderr.isTTY === true &&
      (process.env.NO_COLOR === undefined || process.env.NO_COLOR === "");
  }

  start(label: string): void {
    this.label = label;
    if (!this.active) return;
    this.timer = setInterval(() => this.render(), 80);
    this.timer.unref?.();
  }

  update(label: string): void {
    this.label = label;
    if (!this.active) this.render();
  }

  private render(): void {
    if (!this.active) return;
    const spin = FRAMES[this.frame++ % FRAMES.length]!;
    process.stderr.write(`\r\x1b[K${dim(`${spin} ${this.label}`)}`);
  }

  /** Clear the line so the report starts on clean output. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.active) process.stderr.write("\r\x1b[K");
  }
}
