export function die(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}
