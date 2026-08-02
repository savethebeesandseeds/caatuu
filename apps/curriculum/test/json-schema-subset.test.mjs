import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonSchemaSubsetError,
  assertSupportedJsonSchemaSubset,
  validateJsonSchemaSubset
} from "../src/json-schema-subset.mjs";

const contractSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://caatuu.org/schema/test-subset.json",
  title: "JSON Schema subset test contract",
  type: "object",
  additionalProperties: false,
  required: ["mode", "entries", "features", "level"],
  properties: {
    mode: { enum: ["open", "locked"] },
    entries: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { $ref: "#/$defs/entry" }
    },
    features: {
      type: "object",
      minProperties: 1,
      propertyNames: { pattern: "^[a-z][a-z-]+$" },
      additionalProperties: { $ref: "#/$defs/featureValue" }
    },
    level: { type: "integer", minimum: 1, maximum: 5 },
    note: {
      oneOf: [
        { type: "string", minLength: 1 },
        { type: "null" }
      ]
    }
  },
  allOf: [
    {
      if: {
        required: ["mode"],
        properties: { mode: { const: "locked" } }
      },
      then: {
        required: ["level"],
        properties: { level: { const: 5 } }
      }
    }
  ],
  $defs: {
    entry: {
      type: "object",
      additionalProperties: false,
      required: ["id", "label", "active"],
      properties: {
        id: { type: "string", pattern: "^item\\.[a-z]+$" },
        label: { type: "string", minLength: 1 },
        active: { type: "boolean" }
      }
    },
    featureValue: {
      oneOf: [
        { type: ["string", "number", "boolean"] },
        {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: ["string", "number", "boolean"] }
        }
      ]
    }
  }
};

function issue(result, keyword, instancePath) {
  return result.errors.find((error) => (
    error.keyword === keyword && error.instancePath === instancePath
  ));
}

test("the dependency-free subset validates the schema vocabulary used by curriculum catalogs", () => {
  const result = validateJsonSchemaSubset(contractSchema, {
    mode: "open",
    entries: [{ id: "item.alpha", label: "Alpha", active: true }],
    features: {
      "verb-person": 1,
      "verb-tags": ["present", "singular"]
    },
    level: 3,
    note: null
  }, { instancePath: "/catalog" });

  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.errors, []);
});

test("strict objects report both missing typo targets and unknown typo fields", () => {
  const result = validateJsonSchemaSubset(contractSchema, {
    mode: "open",
    entries: [{ id: "item.alpha", lable: "Alpha", active: true }],
    features: { "verb-person": 1 },
    level: 3
  }, { instancePath: "/catalog" });

  assert.equal(result.valid, false);
  assert.ok(issue(result, "required", "/catalog/entries/0/label"));
  assert.ok(issue(result, "additionalProperties", "/catalog/entries/0/lable"));
});

test("collection, property-name, and numeric constraints retain precise JSON Pointer paths", () => {
  const duplicate = { id: "item.alpha", label: "Alpha", active: true };
  const result = validateJsonSchemaSubset(contractSchema, {
    mode: "open",
    entries: [duplicate, { ...duplicate }],
    features: { "Bad/feature": "present" },
    level: 6
  }, { instancePath: "/catalog" });

  assert.ok(issue(result, "uniqueItems", "/catalog/entries/1"));
  assert.ok(issue(result, "pattern", "/catalog/features/Bad~1feature"));
  assert.ok(issue(result, "maximum", "/catalog/level"));
});

test("oneOf and if/then constraints are enforced without leaking failed condition errors", () => {
  const invalid = validateJsonSchemaSubset(contractSchema, {
    mode: "locked",
    entries: [{ id: "item.alpha", label: "Alpha", active: true }],
    features: { "verb-person": true },
    level: 4,
    note: ""
  });
  assert.ok(issue(invalid, "const", "/level"));
  assert.ok(issue(invalid, "oneOf", "/note"));
  assert.ok(issue(invalid, "minLength", "/note"));

  const open = validateJsonSchemaSubset(contractSchema, {
    mode: "open",
    entries: [{ id: "item.alpha", label: "Alpha", active: true }],
    features: { "verb-person": true },
    level: 4
  });
  assert.equal(open.valid, true, JSON.stringify(open.errors, null, 2));
});

test("unsupported keywords and non-local or unresolved references fail closed", () => {
  assert.throws(
    () => assertSupportedJsonSchemaSubset({ type: "object", unevaluatedProperties: false }),
    (caught) => caught instanceof JsonSchemaSubsetError
      && caught.code === "JSON_SCHEMA_UNSUPPORTED_KEYWORD"
      && caught.schemaPath === "#/unevaluatedProperties"
  );
  assert.throws(
    () => validateJsonSchemaSubset({ $ref: "https://example.test/schema.json" }, {}),
    (caught) => caught instanceof JsonSchemaSubsetError
      && caught.code === "JSON_SCHEMA_UNSUPPORTED_REFERENCE"
  );
  assert.throws(
    () => validateJsonSchemaSubset({ $ref: "#/$defs/missing", $defs: {} }, {}),
    (caught) => caught instanceof JsonSchemaSubsetError
      && caught.code === "JSON_SCHEMA_UNKNOWN_REFERENCE"
  );
});
