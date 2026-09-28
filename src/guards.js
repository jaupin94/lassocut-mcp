// Credit safety rules: an assistant can chain many images, so spending is capped in code, not in prompts.
export const MAX_IMAGES = 50;
export const CONFIRM_OVER = 10;

export function tooMany(count) {
  return count > MAX_IMAGES ? `Too many images (${count}). The limit is ${MAX_IMAGES} per request: split the job.` : null;
}

export function needsConfirmation({ size, count, confirm }) {
  return size === "full" && count > CONFIRM_OVER && !confirm;
}

export function confirmationMessage(count, balance) {
  const bal = balance == null ? "unknown" : `${balance} credits`;
  return `Full size costs 1 credit per image: ${count} images = ${count} credits. Balance: ${bal}. Ask the user to confirm, then call again with confirm_cost: true.`;
}

export function notEnough({ size, count, balance }) {
  if (size !== "full" || balance == null || balance >= count) return null;
  return `Not enough credits: ${balance} left, ${count} needed. Buy a pack at https://www.lassocut.com/account/ or use size: preview.`;
}
