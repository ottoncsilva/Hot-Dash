// Utility to generate a random typing delay between 4–6 seconds
export function randomDelay(): number {
  const min = 4000; // 4 seconds
  const max = 6000; // 6 seconds
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
