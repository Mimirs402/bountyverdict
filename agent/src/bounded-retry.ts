export async function runBoundedAttempts<T>(
  maximumAttempts: number,
  action: (attempt: number) => Promise<T>,
  successful: (result: T) => boolean,
  onRetry?: (attempt: number, result: T) => void,
): Promise<T> {
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 3) {
    throw new Error("maximumAttempts must be an integer from 1 through 3.");
  }

  let result: T | undefined;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    result = await action(attempt);
    if (successful(result) || attempt === maximumAttempts) return result;
    onRetry?.(attempt, result);
  }

  throw new Error("Bounded retry loop ended without a result.");
}
