export async function readPassword(fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    const value = (await Bun.stdin.text()).replace(/\r?\n$/, "");
    if (!value) throw new Error("Password is required");
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
        validate: (value) => value.length > 0 || "Password is required",
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
