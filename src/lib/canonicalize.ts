export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
type JSONObject = { [key: string]: JSONValue };
type JSONArray = JSONValue[];

const isObject = (value: JSONValue): value is JSONObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const sortObjectKeys = (value: JSONObject): JSONObject => {
  const sortedEntries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sortedEntries.reduce<JSONObject>((acc, [key, val]) => {
    acc[key] = normalizeValue(val);
    return acc;
  }, {});
};

const normalizeNumber = (value: number): number => {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Number(value);
};

const normalizeValue = (value: JSONValue): JSONValue => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (isObject(value)) {
    return sortObjectKeys(value);
  }
  if (typeof value === "number") {
    return normalizeNumber(value);
  }
  return value;
};

export const canonicalize = (value: JSONValue): string => {
  const normalized = normalizeValue(value);
  return JSON.stringify(normalized);
};
