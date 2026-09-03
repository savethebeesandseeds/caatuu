import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonSchemaSubsetError,
  assertSupportedJsonSchemaSubset,
  validateJsonSchemaSubset
} from "../tooling/json-schema-subset.mjs";

test("tuple schemas validate prefix items and reject trailing or excess values", () => {
  const schema = {
    type: "array",
    prefixItems: [{ type: "string" }, { type: "integer" }],
    items: false,
    minItems: 2,
    maxItems: 2
  };

  assert.deepEqual(validateJsonSchemaSubset(schema, ["tile", 2]), { valid: true, errors: [] });

  const wrongTuple = validateJsonSchemaSubset(schema, ["tile", "2"]);
  assert.equal(wrongTuple.valid, false);
  assert.equal(wrongTuple.errors.some((error) => error.instancePath === "/1" && error.keyword === "type"), true);

  const longTuple = validateJsonSchemaSubset(schema, ["tile", 2, true]);
  assert.equal(longTuple.valid, false);
  assert.equal(longTuple.errors.some((error) => error.keyword === "maxItems"), true);
  assert.equal(longTuple.errors.some((error) => error.instancePath === "/2" && error.keyword === "falseSchema"), true);
});

test("items still applies to every array value when prefixItems is absent", () => {
  const result = validateJsonSchemaSubset(
    { type: "array", items: { type: "integer" } },
    [1, "two", 3]
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.instancePath), ["/1"]);
});

test("pattern properties participate in validation and additional-property ownership", () => {
  const schema = {
    type: "object",
    properties: {
      "x-fixed": { type: "number" }
    },
    patternProperties: {
      "^x-": { type: "integer" }
    },
    additionalProperties: false
  };

  assert.equal(validateJsonSchemaSubset(schema, { "x-fixed": 2, "x-other": 3 }).valid, true);

  const patternedFailure = validateJsonSchemaSubset(schema, { "x-fixed": 2.5 });
  assert.equal(patternedFailure.valid, false);
  assert.equal(patternedFailure.errors.some((error) => error.keyword === "type"), true);

  const additionalFailure = validateJsonSchemaSubset(schema, { unrelated: 1 });
  assert.equal(additionalFailure.valid, false);
  assert.equal(additionalFailure.errors[0].keyword, "additionalProperties");
});

test("exclusive numeric bounds remain strict at their boundary", () => {
  const schema = { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 90 };

  assert.equal(validateJsonSchemaSubset(schema, 45).valid, true);
  assert.equal(validateJsonSchemaSubset(schema, 0).errors[0].keyword, "exclusiveMinimum");
  assert.equal(validateJsonSchemaSubset(schema, 90).errors[0].keyword, "exclusiveMaximum");
});

test("new subset keyword definitions are checked before instance validation", () => {
  assert.throws(
    () => assertSupportedJsonSchemaSubset({ prefixItems: "not-an-array" }),
    (caught) => caught instanceof JsonSchemaSubsetError
      && caught.code === "JSON_SCHEMA_INVALID_KEYWORD_VALUE"
  );
  assert.throws(
    () => assertSupportedJsonSchemaSubset({ patternProperties: { "[": true } }),
    (caught) => caught instanceof JsonSchemaSubsetError
      && caught.schemaPath.includes("patternProperties")
  );
  assert.throws(
    () => assertSupportedJsonSchemaSubset({ maxItems: -1 }),
    (caught) => caught instanceof JsonSchemaSubsetError
      && caught.schemaPath.endsWith("/maxItems")
  );
});
