/**
 * Reads an environment variable, treating an empty value as unset.
 *
 * .env.local is a copy of .env.example, so every optional variable arrives as
 * an empty string rather than as undefined. Without this, `??` sees a defined
 * value and the defaults never apply — an empty DATA_DIR becomes mkdir("").
 */
export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
