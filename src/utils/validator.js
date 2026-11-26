/**
 * Bộ kiểm tra dữ liệu đầu vào nhẹ (Zod-style declarative schema validator, zero dependency).
 * Trả về lỗi có cấu trúc với danh sách field vi phạm.
 */

class ValidationError extends Error {
  constructor(details, message = 'Dữ liệu đầu vào không hợp lệ.') {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

const s = {
  string({ min = 0, max = 5000, trim = true, pattern = null, optional = false, defaultValue } = {}) {
    return { kind: 'string', min, max, trim, pattern, optional, defaultValue };
  },
  number({ min = -Infinity, max = Infinity, integer = false, optional = false, defaultValue } = {}) {
    return { kind: 'number', min, max, integer, optional, defaultValue };
  },
  boolean({ optional = false, defaultValue } = {}) {
    return { kind: 'boolean', optional, defaultValue };
  },
  enum(values, { optional = false, defaultValue } = {}) {
    return { kind: 'enum', values, optional, defaultValue };
  },
  array(itemRule, { min = 0, max = 5000, optional = false, defaultValue } = {}) {
    return { kind: 'array', itemRule, min, max, optional, defaultValue };
  },
  object(shape = {}, { optional = false, passthrough = false, defaultValue } = {}) {
    return { kind: 'object', shape, optional, passthrough, defaultValue };
  }
};

function validateValue(rule, value, fieldPath = 'body') {
  if (value === undefined || value === null) {
    if (rule.defaultValue !== undefined) {
      return { ok: true, value: typeof rule.defaultValue === 'function' ? rule.defaultValue() : rule.defaultValue };
    }
    if (rule.optional) {
      return { ok: true, value };
    }
    return { ok: false, errors: [{ path: fieldPath, message: 'Trường này là bắt buộc.' }] };
  }

  switch (rule.kind) {
    case 'string': {
      let val = typeof value === 'string' ? value : String(value);
      if (rule.trim) val = val.trim();
      if (val.length < rule.min) {
        return { ok: false, errors: [{ path: fieldPath, message: `Phải có ít nhất ${rule.min} ký tự.` }] };
      }
      if (val.length > rule.max) {
        return { ok: false, errors: [{ path: fieldPath, message: `Không được vượt quá ${rule.max} ký tự.` }] };
      }
      if (rule.pattern && !rule.pattern.test(val)) {
        return { ok: false, errors: [{ path: fieldPath, message: 'Định dạng không hợp lệ.' }] };
      }
      return { ok: true, value: val };
    }
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) {
        return { ok: false, errors: [{ path: fieldPath, message: 'Phải là một số hợp lệ.' }] };
      }
      if (rule.integer && !Number.isInteger(num)) {
        return { ok: false, errors: [{ path: fieldPath, message: 'Phải là số nguyên.' }] };
      }
      if (num < rule.min || num > rule.max) {
        return {
          ok: false,
          errors: [{ path: fieldPath, message: `Giá trị phải nằm trong khoảng [${rule.min}, ${rule.max}].` }]
        };
      }
      return { ok: true, value: num };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 'true' || value === 1 || value === '1') return { ok: true, value: true };
      if (value === 'false' || value === 0 || value === '0') return { ok: true, value: false };
      return { ok: false, errors: [{ path: fieldPath, message: 'Phải là true hoặc false.' }] };
    }
    case 'enum': {
      if (!rule.values.includes(value)) {
        return {
          ok: false,
          errors: [{ path: fieldPath, message: `Giá trị phải thuộc: ${rule.values.join(', ')}.` }]
        };
      }
      return { ok: true, value };
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return { ok: false, errors: [{ path: fieldPath, message: 'Phải là danh sách (mảng).' }] };
      }
      if (value.length < rule.min || value.length > rule.max) {
        return {
          ok: false,
          errors: [{ path: fieldPath, message: `Số lượng phần tử phải trong khoảng [${rule.min}, ${rule.max}].` }]
        };
      }
      const parsed = [];
      const errors = [];
      for (let i = 0; i < value.length; i++) {
        const res = validateValue(rule.itemRule, value[i], `${fieldPath}[${i}]`);
        if (res.ok) parsed.push(res.value);
        else errors.push(...res.errors);
      }
      return errors.length ? { ok: false, errors } : { ok: true, value: parsed };
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, errors: [{ path: fieldPath, message: 'Phải là object JSON.' }] };
      }
      const out = rule.passthrough ? { ...value } : {};
      const errors = [];
      for (const [k, fieldRule] of Object.entries(rule.shape)) {
        const res = validateValue(fieldRule, value[k], `${fieldPath}.${k}`);
        if (res.ok) {
          if (res.value !== undefined) out[k] = res.value;
        } else {
          errors.push(...res.errors);
        }
      }
      return errors.length ? { ok: false, errors } : { ok: true, value: out };
    }
    default:
      return { ok: true, value };
  }
}

function parseSchema(rule, data) {
  const res = validateValue(rule, data);
  if (!res.ok) {
    throw new ValidationError(res.errors);
  }
  return res.value;
}

function validateBody(rule) {
  return (req, res, next) => {
    try {
      req.validatedBody = parseSchema(rule, req.body || {});
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  s,
  parseSchema,
  validateBody,
  ValidationError
};
