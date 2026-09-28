import { test } from "node:test";
import assert from "node:assert/strict";
import { tooMany, needsConfirmation, confirmationMessage, notEnough } from "../src/guards.js";

test("50 images max per request", () => {
  assert.equal(tooMany(50), null);
  assert.equal(tooMany(51), "Too many images (51). The limit is 50 per request: split the job.");
});

test("full size over 10 images needs confirm_cost, previews never do", () => {
  assert.equal(needsConfirmation({ size: "full", count: 10, confirm: false }), false);
  assert.equal(needsConfirmation({ size: "full", count: 11, confirm: false }), true);
  assert.equal(needsConfirmation({ size: "full", count: 11, confirm: true }), false);
  assert.equal(needsConfirmation({ size: "preview", count: 50, confirm: false }), false);
});

test("confirmation message states cost and balance", () => {
  assert.equal(confirmationMessage(12, 30),
    "Full size costs 1 credit per image: 12 images = 12 credits. Balance: 30 credits. Ask the user to confirm, then call again with confirm_cost: true.");
});

test("confirmation message says 'unknown' when the balance could not be read", () => {
  assert.equal(confirmationMessage(12, null),
    "Full size costs 1 credit per image: 12 images = 12 credits. Balance: unknown. Ask the user to confirm, then call again with confirm_cost: true.");
});

test("not enough credits for full size is refused before sending", () => {
  assert.equal(notEnough({ size: "full", count: 5, balance: 3 }),
    "Not enough credits: 3 left, 5 needed. Buy a pack at https://www.lassocut.com/account/ or use size: preview.");
  assert.equal(notEnough({ size: "full", count: 5, balance: 5 }), null);
  assert.equal(notEnough({ size: "preview", count: 5, balance: 0 }), null);
  assert.equal(notEnough({ size: "full", count: 5, balance: null }), null);
});
