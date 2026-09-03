const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "prefixItems",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "minLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "allOf",
  "oneOf",
  "if",
  "then"
]);

const JSON_TYPES = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "string",
  "integer"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapePointerToken(value) {
  return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function appendPointer(base, value) {
  return `${base}/${escapePointerToken(value)}`;
}

function jsonEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left === "number" && typeof right === "number") return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && jsonEqual(left[key], right[key])
    ));
}

function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return isObject(value);
  if (expected === "integer") return Number.isFinite(value) && Number.isInteger(value);
  if (expected === "number") return Number.isFinite(value) && typeof value === "number";
  return typeof value === expected;
}

function assertNonNegativeInteger(value, keyword, schemaPath) {
  if (!Number.isInteger(value) || value < 0) {
    throw new JsonSchemaSubsetError(
      "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
      appendPointer(schemaPath, keyword),
      `${keyword} must be a non-negative integer.`
    );
  }
}

function resolveLocalReference(rootSchema, reference, schemaPath) {
  if (typeof reference !== "string" || (!reference.startsWith("#/") && reference !== "#")) {
    throw new JsonSchemaSubsetError(
      "JSON_SCHEMA_UNSUPPORTED_REFERENCE",
      appendPointer(schemaPath, "$ref"),
      "Only local JSON Pointer references are supported."
    );
  }
  if (reference === "#") return rootSchema;

  let current = rootSchema;
  for (const encodedToken of reference.slice(2).split("/")) {
    const token = encodedToken.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if ((!isObject(current) && !Array.isArray(current)) || !Object.hasOwn(current, token)) {
      throw new JsonSchemaSubsetError(
        "JSON_SCHEMA_UNKNOWN_REFERENCE",
        appendPointer(schemaPath, "$ref"),
        `Local reference ${reference} does not resolve.`
      );
    }
    current = current[token];
  }
  return current;
}

export class JsonSchemaSubsetError extends Error {
  constructor(code, schemaPath, message) {
    super(message);
    this.name = "JsonSchemaSubsetError";
    this.code = code;
    this.schemaPath = schemaPath;
  }
}

/**
 * Reject schemas that use constraints this dependency-free validator would
 * otherwise ignore. This is intentionally a small Draft 2020-12 subset.
 */
export function assertSupportedJsonSchemaSubset(schema) {
  const visited = new WeakSet();

  const visit = (node, schemaPath, rootSchema) => {
    if (typeof node === "boolean") return;
    if (!isObject(node)) {
      throw new JsonSchemaSubsetError(
        "JSON_SCHEMA_INVALID_SCHEMA",
        schemaPath,
        "A schema must be an object or boolean."
      );
    }
    if (visited.has(node)) return;
    visited.add(node);

    for (const keyword of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_UNSUPPORTED_KEYWORD",
          appendPointer(schemaPath, keyword),
          `Unsupported JSON Schema keyword: ${keyword}.`
        );
      }
    }

    for (const keyword of ["$schema", "$id", "title"]) {
      if (node[keyword] !== undefined && typeof node[keyword] !== "string") {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, keyword),
          `${keyword} must be a string.`
        );
      }
    }

    if (node.$ref !== undefined) {
      resolveLocalReference(rootSchema, node.$ref, schemaPath);
    }

    if (node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      if (types.length === 0
          || types.some((type) => typeof type !== "string" || !JSON_TYPES.has(type))
          || new Set(types).size !== types.length) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, "type"),
          "type must name one or more distinct JSON Schema primitive types."
        );
      }
    }

    if (node.enum !== undefined) {
      if (!Array.isArray(node.enum) || node.enum.length === 0) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, "enum"),
          "enum must be a non-empty array."
        );
      }
      for (let index = 0; index < node.enum.length; index += 1) {
        if (node.enum.slice(0, index).some((value) => jsonEqual(value, node.enum[index]))) {
          throw new JsonSchemaSubsetError(
            "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
            appendPointer(schemaPath, "enum"),
            "enum values must be unique."
          );
        }
      }
    }

    if (node.required !== undefined) {
      if (!Array.isArray(node.required)
          || node.required.some((key) => typeof key !== "string")
          || new Set(node.required).size !== node.required.length) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, "required"),
          "required must be an array of distinct property names."
        );
      }
    }

    for (const keyword of ["minItems", "maxItems", "minProperties", "minLength"]) {
      if (node[keyword] !== undefined) {
        assertNonNegativeInteger(node[keyword], keyword, schemaPath);
      }
    }

    if (node.uniqueItems !== undefined && typeof node.uniqueItems !== "boolean") {
      throw new JsonSchemaSubsetError(
        "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
        appendPointer(schemaPath, "uniqueItems"),
        "uniqueItems must be boolean."
      );
    }

    for (const keyword of [
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum"
    ]) {
      if (node[keyword] !== undefined
          && (typeof node[keyword] !== "number" || !Number.isFinite(node[keyword]))) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, keyword),
          `${keyword} must be a finite number.`
        );
      }
    }

    if (node.pattern !== undefined) {
      if (typeof node.pattern !== "string") {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, "pattern"),
          "pattern must be a string."
        );
      }
      try {
        new RegExp(node.pattern, "u");
      } catch (caught) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, "pattern"),
          `pattern is not a valid regular expression: ${caught.message}`
        );
      }
    }

    for (const keyword of ["properties", "patternProperties", "$defs"]) {
      if (node[keyword] === undefined) continue;
      if (!isObject(node[keyword])) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, keyword),
          `${keyword} must be an object of schemas.`
        );
      }
      for (const [name, child] of Object.entries(node[keyword])) {
        if (keyword === "patternProperties") {
          try {
            new RegExp(name, "u");
          } catch (caught) {
            throw new JsonSchemaSubsetError(
              "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
              appendPointer(appendPointer(schemaPath, keyword), name),
              `patternProperties key is not a valid regular expression: ${caught.message}`
            );
          }
        }
        visit(child, appendPointer(appendPointer(schemaPath, keyword), name), rootSchema);
      }
    }

    if (node.prefixItems !== undefined) {
      if (!Array.isArray(node.prefixItems)) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, "prefixItems"),
          "prefixItems must be an array of schemas."
        );
      }
      node.prefixItems.forEach((child, index) => {
        visit(
          child,
          appendPointer(appendPointer(schemaPath, "prefixItems"), index),
          rootSchema
        );
      });
    }

    if (node.additionalProperties !== undefined) {
      if (typeof node.additionalProperties !== "boolean" && !isObject(node.additionalProperties)) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, "additionalProperties"),
          "additionalProperties must be a boolean or schema."
        );
      }
      if (isObject(node.additionalProperties)) {
        visit(
          node.additionalProperties,
          appendPointer(schemaPath, "additionalProperties"),
          rootSchema
        );
      }
    }

    for (const keyword of ["propertyNames", "items", "if", "then"]) {
      if (node[keyword] !== undefined) {
        visit(node[keyword], appendPointer(schemaPath, keyword), rootSchema);
      }
    }

    for (const keyword of ["allOf", "oneOf"]) {
      if (node[keyword] === undefined) continue;
      if (!Array.isArray(node[keyword]) || node[keyword].length === 0) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_INVALID_KEYWORD_VALUE",
          appendPointer(schemaPath, keyword),
          `${keyword} must be a non-empty array of schemas.`
        );
      }
      node[keyword].forEach((child, index) => {
        visit(child, appendPointer(appendPointer(schemaPath, keyword), index), rootSchema);
      });
    }
  };

  visit(schema, "#", schema);
}

/**
 * Validate JSON-compatible data against the supported schema subset.
 * Returns stable JSON Pointer paths suitable for authoring diagnostics.
 */
export function validateJsonSchemaSubset(schema, instance, options = {}) {
  assertSupportedJsonSchemaSubset(schema);
  const rootInstancePath = options.instancePath || "";

  const validateNode = (
    node,
    value,
    instancePath,
    schemaPath,
    rootSchema,
    activeReferences = new Set()
  ) => {
    if (node === true) return [];
    if (node === false) {
      return [{
        keyword: "falseSchema",
        instancePath,
        schemaPath,
        message: "Value is forbidden by the schema."
      }];
    }

    const errors = [];
    const addError = (keyword, path, message) => {
      errors.push({
        keyword,
        instancePath: path,
        schemaPath: appendPointer(schemaPath, keyword),
        message
      });
    };

    if (node.$ref !== undefined) {
      const referenceKey = `${node.$ref}\u0000${instancePath}`;
      if (activeReferences.has(referenceKey)) {
        throw new JsonSchemaSubsetError(
          "JSON_SCHEMA_RECURSIVE_REFERENCE",
          appendPointer(schemaPath, "$ref"),
          `Reference ${node.$ref} recursively validates the same instance location.`
        );
      }
      const nextReferences = new Set(activeReferences);
      nextReferences.add(referenceKey);
      errors.push(...validateNode(
        resolveLocalReference(rootSchema, node.$ref, schemaPath),
        value,
        instancePath,
        node.$ref,
        rootSchema,
        nextReferences
      ));
    }

    if (node.const !== undefined && !jsonEqual(value, node.const)) {
      addError("const", instancePath, `Expected the constant value ${JSON.stringify(node.const)}.`);
    }
    if (node.enum !== undefined && !node.enum.some((candidate) => jsonEqual(value, candidate))) {
      addError("enum", instancePath, `Expected one of ${JSON.stringify(node.enum)}.`);
    }

    if (node.type !== undefined) {
      const expectedTypes = Array.isArray(node.type) ? node.type : [node.type];
      if (!expectedTypes.some((expected) => matchesType(value, expected))) {
        addError(
          "type",
          instancePath,
          `Expected ${expectedTypes.join(" or ")}; received ${describeType(value)}.`
        );
      }
    }

    for (const [index, child] of (node.allOf || []).entries()) {
      errors.push(...validateNode(
        child,
        value,
        instancePath,
        appendPointer(appendPointer(schemaPath, "allOf"), index),
        rootSchema,
        activeReferences
      ));
    }

    if (node.oneOf) {
      const branchResults = node.oneOf.map((child, index) => validateNode(
        child,
        value,
        instancePath,
        appendPointer(appendPointer(schemaPath, "oneOf"), index),
        rootSchema,
        activeReferences
      ));
      const validBranchCount = branchResults.filter((branchErrors) => branchErrors.length === 0).length;
      if (validBranchCount !== 1) {
        addError(
          "oneOf",
          instancePath,
          validBranchCount === 0
            ? "Value must match exactly one schema, but matched none."
            : `Value must match exactly one schema, but matched ${validBranchCount}.`
        );
        if (validBranchCount === 0) {
          const closestBranch = branchResults.reduce((closest, branch) => (
            closest === null || branch.length < closest.length ? branch : closest
          ), null);
          errors.push(...(closestBranch || []));
        }
      }
    }

    if (node.if !== undefined) {
      const conditionErrors = validateNode(
        node.if,
        value,
        instancePath,
        appendPointer(schemaPath, "if"),
        rootSchema,
        activeReferences
      );
      if (conditionErrors.length === 0 && node.then !== undefined) {
        errors.push(...validateNode(
          node.then,
          value,
          instancePath,
          appendPointer(schemaPath, "then"),
          rootSchema,
          activeReferences
        ));
      }
    }

    if (isObject(value)) {
      const propertySchemas = node.properties || {};
      const patternPropertySchemas = Object.entries(node.patternProperties || {})
        .map(([pattern, child]) => [new RegExp(pattern, "u"), pattern, child]);
      for (const requiredProperty of node.required || []) {
        if (!Object.hasOwn(value, requiredProperty)) {
          addError(
            "required",
            appendPointer(instancePath, requiredProperty),
            `Missing required property ${JSON.stringify(requiredProperty)}.`
          );
        }
      }

      for (const [property, child] of Object.entries(propertySchemas)) {
        if (!Object.hasOwn(value, property)) continue;
        errors.push(...validateNode(
          child,
          value[property],
          appendPointer(instancePath, property),
          appendPointer(appendPointer(schemaPath, "properties"), property),
          rootSchema,
          activeReferences
        ));
      }

      for (const property of Object.keys(value)) {
        for (const [pattern, patternText, child] of patternPropertySchemas) {
          if (!pattern.test(property)) continue;
          errors.push(...validateNode(
            child,
            value[property],
            appendPointer(instancePath, property),
            appendPointer(appendPointer(schemaPath, "patternProperties"), patternText),
            rootSchema,
            activeReferences
          ));
        }
      }

      if (node.propertyNames !== undefined) {
        for (const property of Object.keys(value)) {
          errors.push(...validateNode(
            node.propertyNames,
            property,
            appendPointer(instancePath, property),
            appendPointer(schemaPath, "propertyNames"),
            rootSchema,
            activeReferences
          ));
        }
      }

      const additionalProperties = Object.keys(value)
        .filter((property) => (
          !Object.hasOwn(propertySchemas, property)
          && !patternPropertySchemas.some(([pattern]) => pattern.test(property))
        ));
      if (node.additionalProperties === false) {
        for (const property of additionalProperties) {
          addError(
            "additionalProperties",
            appendPointer(instancePath, property),
            `Unknown property ${JSON.stringify(property)}.`
          );
        }
      } else if (isObject(node.additionalProperties)) {
        for (const property of additionalProperties) {
          errors.push(...validateNode(
            node.additionalProperties,
            value[property],
            appendPointer(instancePath, property),
            appendPointer(schemaPath, "additionalProperties"),
            rootSchema,
            activeReferences
          ));
        }
      }

      if (node.minProperties !== undefined && Object.keys(value).length < node.minProperties) {
        addError(
          "minProperties",
          instancePath,
          `Expected at least ${node.minProperties} properties.`
        );
      }
    }

    if (Array.isArray(value)) {
      if (node.minItems !== undefined && value.length < node.minItems) {
        addError("minItems", instancePath, `Expected at least ${node.minItems} items.`);
      }
      if (node.maxItems !== undefined && value.length > node.maxItems) {
        addError("maxItems", instancePath, `Expected at most ${node.maxItems} items.`);
      }
      if (node.uniqueItems === true) {
        for (let index = 0; index < value.length; index += 1) {
          const duplicateIndex = value.slice(0, index)
            .findIndex((candidate) => jsonEqual(candidate, value[index]));
          if (duplicateIndex >= 0) {
            addError(
              "uniqueItems",
              appendPointer(instancePath, index),
              `Item duplicates index ${duplicateIndex}.`
            );
          }
        }
      }
      const prefixLength = node.prefixItems?.length ?? 0;
      for (let index = 0; index < Math.min(prefixLength, value.length); index += 1) {
        errors.push(...validateNode(
          node.prefixItems[index],
          value[index],
          appendPointer(instancePath, index),
          appendPointer(appendPointer(schemaPath, "prefixItems"), index),
          rootSchema,
          activeReferences
        ));
      }
      if (node.items !== undefined) {
        value.slice(prefixLength).forEach((item, relativeIndex) => {
          const index = prefixLength + relativeIndex;
          errors.push(...validateNode(
            node.items,
            item,
            appendPointer(instancePath, index),
            appendPointer(schemaPath, "items"),
            rootSchema,
            activeReferences
          ));
        });
      }
    }

    if (typeof value === "string") {
      if (node.minLength !== undefined && [...value].length < node.minLength) {
        addError("minLength", instancePath, `Expected at least ${node.minLength} characters.`);
      }
      if (node.pattern !== undefined && !(new RegExp(node.pattern, "u")).test(value)) {
        addError("pattern", instancePath, `Value does not match ${JSON.stringify(node.pattern)}.`);
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      if (node.minimum !== undefined && value < node.minimum) {
        addError("minimum", instancePath, `Expected a value greater than or equal to ${node.minimum}.`);
      }
      if (node.maximum !== undefined && value > node.maximum) {
        addError("maximum", instancePath, `Expected a value less than or equal to ${node.maximum}.`);
      }
      if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {
        addError(
          "exclusiveMinimum",
          instancePath,
          `Expected a value greater than ${node.exclusiveMinimum}.`
        );
      }
      if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) {
        addError(
          "exclusiveMaximum",
          instancePath,
          `Expected a value less than ${node.exclusiveMaximum}.`
        );
      }
    }

    return errors;
  };

  const errors = validateNode(schema, instance, rootInstancePath, "#", schema);
  return { valid: errors.length === 0, errors };
}
