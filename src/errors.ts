/**
 * Errors that represent a clear, actionable problem for the user.
 * The CLI prints these without a stack trace; anything else is a real crash.
 */
export class ProfilerError extends Error {
  readonly details?: string;

  constructor(message: string, details?: string) {
    super(message);
    this.name = "ProfilerError";
    this.details = details;
  }
}

/** The contract compiled fine but contains nothing that needs a proof. */
export class NoProvableCircuitsError extends ProfilerError {
  constructor(source: string) {
    super(
      `No provable circuits in ${source}`,
      "The contract compiled, but emitted no ZKIR. Circuits that touch neither\n" +
        "ledger state nor a witness need no proof, so there is nothing to measure.",
    );
    this.name = "NoProvableCircuitsError";
  }
}
