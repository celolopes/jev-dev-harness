import type { ClosedParam, ToolDefinition, ToolParameterSchema, ToolPlan } from "./types.js";

/**
 * Extracts closed parameter metadata from JSON Schema properties.
 * Identifies booleans, enums, and constants that Jev can reason about directly.
 */
export function resolveClosedParam(
  paramName: string,
  schema: ToolParameterSchema,
  required: boolean
): ClosedParam | undefined {
  if (!schema || typeof schema !== "object") return undefined;

  // 1. Const value
  if ("const" in schema && schema.const !== undefined) {
    return {
      name: paramName,
      required,
      kind: "const",
      value: schema.const,
      description: schema.description,
    };
  }

  // 2. Enum values
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (schema.enum.length === 1) {
      return {
        name: paramName,
        required,
        kind: "const",
        value: schema.enum[0],
        description: schema.description,
      };
    }
    const stringValues = schema.enum.map((v) => String(v));
    if (stringValues.length <= 255) {
      return {
        name: paramName,
        required,
        kind: "enum",
        values: stringValues,
        description: schema.description,
      };
    }
  }

  // 3. Boolean
  if (schema.type === "boolean") {
    return {
      name: paramName,
      required,
      kind: "boolean",
      values: ["true", "false"],
      description: schema.description,
    };
  }

  return undefined;
}

/**
 * Build a structured ToolPlan analyzing all declared parameters of a tool.
 */
export function planTool(tool: ToolDefinition): ToolPlan {
  const name = tool.name;
  const description = tool.description || "";
  const params = tool.parameters;

  if (!params || typeof params !== "object") {
    return { name, description };
  }

  const properties = (params.properties || {}) as Record<string, ToolParameterSchema>;
  const requiredList = Array.isArray(params.required) ? params.required : [];
  const closedParams: ClosedParam[] = [];

  for (const [propName, propSchema] of Object.entries(properties)) {
    const isRequired = requiredList.includes(propName);
    const resolved = resolveClosedParam(propName, propSchema, isRequired);
    if (resolved) {
      closedParams.push(resolved);
    }
  }

  return {
    name,
    description,
    closedParams: closedParams.length > 0 ? closedParams : undefined,
  };
}
