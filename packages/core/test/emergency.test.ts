import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectEmergency, loadPlaybooks } from "../src/emergency.ts";

const playbooks = loadPlaybooks(
  path.join(import.meta.dirname, "../../../corpus/axxiom-s2/v1.0/emergency-playbooks.json"),
);

describe("detectEmergency", () => {
  it("matches emergencies in progress to a playbook", () => {
    expect(
      detectEmergency("my helper is confused and stopped sweating, skin is hot", playbooks)
        ?.playbook?.id,
    ).toBe("heat_illness");
    expect(
      detectEmergency("someone fell down the hoistway at my job", playbooks)?.playbook?.id,
    ).toBe("hoistway_pit_injury");
    expect(
      detectEmergency("a guy just got shocked off the controller and hes not breathing", playbooks)
        ?.playbook?.id,
    ).toBe("electrical_contact");
  });
  it("falls back to the default steps for an unlisted emergency", () => {
    const m = detectEmergency("my coworker is badly hurt and bleeding", playbooks);
    expect(m).not.toBeNull();
    expect(m?.playbook).toBeNull();
  });
  it("sends policy questions to the model", () => {
    expect(
      detectEmergency("What is the procedure if someone is injured on site?", playbooks),
    ).toBeNull();
    expect(detectEmergency("What are the signs of heat stroke?", playbooks)).toBeNull();
    expect(detectEmergency("When can I use a tag instead of a lock?", playbooks)).toBeNull();
  });
});
