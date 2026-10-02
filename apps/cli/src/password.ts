export function validatePassword(value: string): true | string {
  return value.length >= 12 &&
    Buffer.byteLength(value, "utf8") <= 72 &&
    !/[\x00-\x1f\x7f]/.test(value)
    ? true
    : "Password must be at least 12 characters, at most 72 UTF-8 bytes, without control characters";
}

export async function readPassword(fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    const value = (await Bun.stdin.text()).replace(/\r?\n$/, "");
    const valid = validatePassword(value);
    if (valid !== true) throw new Error(valid);
    return value;
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      "Interactive password entry requires a terminal; use --password-stdin for automation",
    );
  }
  // Load prompt dependencies only for interactive account commands, not serve.
  const { default: password } = await import("@inquirer/password");
  try {
    const value = await password(
      {
        message: "Password:",
        mask: "*",
        toggleMask: false,
        validate: validatePassword,
      },
      { output: process.stderr },
    );
    await password(
      {
        message: "Confirm password:",
        mask: "*",
        toggleMask: false,
        validate: (confirmation) =>
          confirmation === value || "Passwords do not match",
      },
      { output: process.stderr },
    );
    return value;
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      throw new Error("Password entry cancelled; account unchanged");
    }
    throw error;
  }
}
