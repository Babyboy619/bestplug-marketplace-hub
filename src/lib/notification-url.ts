export function isSafeInternalPath(value: string): boolean {
  return (
    !value ||
    (value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      ![...value].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }))
  );
}
