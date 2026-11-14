import test from "node:test";
import assert from "node:assert/strict";
import { gsm7Septets, simulateSms, SMS_ACKNOWLEDGEMENT } from "../src/domain/sms.ts";

test("the acknowledgement is exactly 145 GSM-7 characters and septets", () => {
  assert.equal(SMS_ACKNOWLEDGEMENT.length, 145);
  assert.equal(gsm7Septets(SMS_ACKNOWLEDGEMENT), 145);
  for (const kind of ["FLOOD", "DIALYSIS", "TRAUMA"]) {
    const response = simulateSms(`${kind} Tumana`);
    assert.equal(response.accepted, true);
    assert.equal(response.transmitted, false);
    if (response.accepted) assert.equal(response.reply, SMS_ACKNOWLEDGEMENT);
  }
});

test("GSM extension characters use two septets; Unicode is never silently recoded", () => {
  assert.equal(gsm7Septets("[]{}^~\\|€\f"), 20);
  assert.equal(gsm7Septets("ÑéΔ"), 3);
  assert.equal(gsm7Septets("Tumana \u{1f327}"), null);
  assert.equal(gsm7Septets("“Tumana”"), null);
  assert.equal(simulateSms("FLOOD " + "^".repeat(70)).accepted, false);
  assert.equal(simulateSms("FLOOD " + "A".repeat(139)).accepted, true);
  assert.equal(simulateSms("FLOOD " + "A".repeat(140)).accepted, false);
});

test("invalid or multiple-line requests cannot produce an acknowledgement", () => {
  for (const input of ["", "FLOOD", "FLOOD   ", "HELP Tumana", "FLOOD Tumana\nTRAUMA Marikina", "FLOOD \u{1f600}"]) {
    assert.equal(simulateSms(input).accepted, false);
  }
  assert.deepEqual(simulateSms("  flood Tumana  "), simulateSms("FLOOD Tumana"));
});
