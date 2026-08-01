import { describe, expect, it } from "vitest";
import {
  AUTO_PERSONA_ID,
  CUSTOM_PERSONA_ID,
  MOTIVATIONAL_PERSONAS,
  parseWorldDetails,
  personaById,
  renderPersonaBlock,
  resolvePersona,
  type CustomPersonaDraft,
} from "./motivationalPersona";

describe("motivational persona presets", () => {
  it("ships presets that each carry a concrete world, not just a label", () => {
    expect(MOTIVATIONAL_PERSONAS.length).toBeGreaterThanOrEqual(8);
    for (const persona of MOTIVATIONAL_PERSONAS) {
      expect(persona.id).toBeTruthy();
      expect(persona.label).toBeTruthy();
      expect(persona.speaker.length).toBeGreaterThan(30);
      expect(persona.audience.length).toBeGreaterThan(10);
      expect(persona.world.length).toBeGreaterThanOrEqual(4);
      expect(persona.vernacular).toBeTruthy();
    }
  });

  it("uses unique ids", () => {
    const ids = MOTIVATIONAL_PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers more than one point of view", () => {
    const povs = new Set(MOTIVATIONAL_PERSONAS.map((p) => p.pov));
    expect(povs.size).toBeGreaterThan(1);
  });

  it("resolves a known id and returns undefined for auto or unknown ids", () => {
    expect(personaById("acl-comeback")?.label).toMatch(/post-surgery/i);
    expect(personaById(AUTO_PERSONA_ID)).toBeUndefined();
    expect(personaById("nope")).toBeUndefined();
  });
});

describe("parseWorldDetails", () => {
  it("splits on commas and newlines and drops blanks", () => {
    expect(parseWorldDetails("6AM alarm,  cold garage \n\n a taped-up bar , ")).toEqual([
      "6AM alarm",
      "cold garage",
      "a taped-up bar",
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseWorldDetails("   ")).toEqual([]);
  });
});

describe("resolvePersona", () => {
  const draft: CustomPersonaDraft = {
    speaker: "A welder taking evening drafting classes",
    audience: "Someone told they are too far along to retrain",
    pov: "first-person",
    world: "sparks on a shop floor, a night-class parking permit",
    vernacular: "Blunt, trade-specific.",
  };

  it("builds a persona from a custom draft", () => {
    const persona = resolvePersona(CUSTOM_PERSONA_ID, draft);
    expect(persona?.speaker).toBe("A welder taking evening drafting classes");
    expect(persona?.world).toEqual(["sparks on a shop floor", "a night-class parking permit"]);
  });

  it("returns undefined for a custom draft with no speaker", () => {
    expect(resolvePersona(CUSTOM_PERSONA_ID, { ...draft, speaker: "  " })).toBeUndefined();
    expect(resolvePersona(CUSTOM_PERSONA_ID, undefined)).toBeUndefined();
  });

  it("fills a default listener when the draft omits one", () => {
    const persona = resolvePersona(CUSTOM_PERSONA_ID, { ...draft, audience: "" });
    expect(persona?.audience).toBeTruthy();
  });

  it("applies a pov override without mutating the preset", () => {
    const preset = personaById("acl-comeback");
    const overridden = resolvePersona("acl-comeback", undefined, "third-person");
    expect(overridden?.pov).toBe("third-person");
    expect(preset?.pov).toBe("first-person");
  });

  it("returns undefined for auto", () => {
    expect(resolvePersona(AUTO_PERSONA_ID)).toBeUndefined();
  });
});

describe("renderPersonaBlock", () => {
  it("renders speaker, listener, pov, world and vernacular for a preset", () => {
    const block = renderPersonaBlock(personaById("night-shift-boards"));
    expect(block).toContain("SPEAKER");
    expect(block).toContain("LISTENER");
    expect(block).toContain("3AM ward lighting");
    expect(block).toContain("FIRST PERSON");
    expect(block).toMatch(/never says 'grind'/i);
  });

  it("states the pov rule matching the persona's stance", () => {
    expect(renderPersonaBlock(personaById("quiet-grinder"))).toContain("SECOND PERSON");
    expect(renderPersonaBlock(resolvePersona("quiet-grinder", undefined, "third-person"))).toContain(
      "THIRD PERSON"
    );
  });

  it("requires the model to invent and commit to a persona when none is set", () => {
    const block = renderPersonaBlock(undefined);
    expect(block).toMatch(/invent ONE specific person/i);
    expect(block).toMatch(/disembodied narrator/i);
    expect(block).toContain("persona");
  });
});
