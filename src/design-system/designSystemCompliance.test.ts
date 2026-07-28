import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const studioDir = path.resolve("src/studio");
const studioFiles = fs.readdirSync(studioDir).filter((name) => name.endsWith(".tsx"));

function violations() {
  const found: string[] = [];
  for (const name of studioFiles) {
    const file = path.join(studioDir, name);
    const source = fs.readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast);
        if (["button", "input", "select", "textarea", "svg"].includes(tag)) {
          found.push(`${name}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} uses <${tag}>`);
        }
        const className = node.attributes.properties.find((property) =>
          ts.isJsxAttribute(property) && property.name.getText(ast) === "className" &&
          property.initializer && ts.isStringLiteral(property.initializer),
        );
        const value = className && ts.isJsxAttribute(className) && className.initializer && ts.isStringLiteral(className.initializer)
          ? className.initializer.text
          : "";
        if (value.includes("st-modal-scrim") && tag !== "ModalScrim") found.push(`${name} has a raw modal scrim`);
        if (value.includes("st-modal-card") && tag !== "ModalSurface") found.push(`${name} has a raw modal surface`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return found;
}

describe("design-system compliance", () => {
  it("keeps studio controls, icons, and modal surfaces inside the design system", () => {
    expect(violations()).toEqual([]);
  });
});
